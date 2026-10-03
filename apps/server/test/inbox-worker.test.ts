import { afterEach, beforeEach, expect, test } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import { eventsubInbox, liveState, mailOutbox } from '../src/db/schema.ts';
import { createBus } from '../src/events/bus.ts';
import {
  createInboxWorker,
  type InboxWorkerDeps,
} from '../src/jobs/inbox-worker.ts';
import type { Logger } from '../src/log.ts';
import { createFakeClock, type FakeClock } from './helpers/clock.ts';
import { createTestDb } from './helpers/db.ts';
import { ELDEN_RING, seedStreamer } from './helpers/seed.ts';

let handle: DbHandle;
let deps: InboxWorkerDeps;
let errors: string[];
let received = 0;

beforeEach(() => {
  handle = createTestDb();
  errors = [];
  received = 1_000;
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error: (msg) => {
      errors.push(msg);
    },
  };
  deps = {
    db: handle.db,
    clock: createFakeClock(),
    bus: createBus(),
    logger,
    timeZone: 'Europe/Berlin',
    helix: {
      getChannels: async (ids) =>
        ids.map((id) => ({
          broadcasterId: id,
          broadcasterLogin: 'x',
          broadcasterName: 'x',
          gameId: ELDEN_RING.id,
          gameName: ELDEN_RING.name,
          title: 't',
        })),
    },
  };
  seedStreamer(handle.db, { id: 'b1', mode: 'custom', games: [ELDEN_RING] });
});
afterEach(() => handle.close());

function enqueue(
  messageId: string,
  subType: string,
  event: Record<string, unknown>,
  type = 'notification',
) {
  handle.db
    .insert(eventsubInbox)
    .values({
      messageId,
      type,
      payload: JSON.stringify({ subscription: { type: subType }, event }),
      receivedAt: received++,
    })
    .run();
}
const inbox = () => handle.db.select().from(eventsubInbox).all();
const outbox = () => handle.db.select().from(mailOutbox).all();

test('restart: pending rows are drained in order without duplicate mails', async () => {
  const worker = createInboxWorker(deps);
  enqueue('m1', 'stream.online', { id: 's1', broadcaster_user_id: 'b1' });
  await worker.drain();
  expect(outbox()).toHaveLength(1);

  // Simulated restart with unprocessed rows, some for the already-notified stream.
  enqueue('m2', 'channel.update', {
    broadcaster_user_id: 'b1',
    category_id: ELDEN_RING.id,
    category_name: ELDEN_RING.name,
    title: 'again',
  });
  enqueue('m3', 'stream.online', { id: 's1', broadcaster_user_id: 'b1' });
  enqueue('m4', 'x', {}, 'revocation');
  const restarted = createInboxWorker(deps);
  await restarted.drain();
  expect(outbox()).toHaveLength(1);
  expect(inbox().every((r) => r.processedAt !== null && r.error === null)).toBe(
    true,
  );
});

test('failing event marks error and the worker continues', async () => {
  enqueue('bad', 'stream.online', { broadcaster_user_id: 'b1' });
  enqueue('good', 'stream.online', { id: 's9', broadcaster_user_id: 'b1' });
  const worker = createInboxWorker(deps);
  await expect(worker.drain()).resolves.toBeUndefined();
  const bad = inbox().find((r) => r.messageId === 'bad');
  expect(bad?.error).toMatch(/without id/);
  expect(bad?.processedAt).not.toBeNull();
  expect(errors).toHaveLength(1);
  expect(outbox()).toHaveLength(1);
});

test('concurrent wakes coalesce and process every row once', async () => {
  const worker = createInboxWorker(deps);
  enqueue('m1', 'stream.online', { id: 's1', broadcaster_user_id: 'b1' });
  worker.wake();
  enqueue('m2', 'stream.offline', { broadcaster_user_id: 'b1' });
  worker.wake();
  await worker.drain();
  expect(inbox().every((r) => r.processedAt !== null)).toBe(true);
  expect(outbox()).toHaveLength(1);
});

test('transient getChannels failure is retried with backoff and then mails', async () => {
  let fail = true;
  const base = deps.helix.getChannels;
  deps.helix = {
    getChannels: async (ids) => {
      if (fail) throw new Error('helix down');
      return base(ids);
    },
  };
  const worker = createInboxWorker(deps);
  enqueue('m1', 'stream.online', { id: 's1', broadcaster_user_id: 'b1' });
  await worker.drain();
  expect(outbox()).toHaveLength(0);
  expect(inbox()[0]).toMatchObject({
    processedAt: null,
    error: null,
    attempts: 1,
  });

  // Not due yet: nothing happens.
  fail = false;
  await worker.drain();
  expect(outbox()).toHaveLength(0);

  (deps.clock as FakeClock).advance(15_000);
  await worker.drain();
  expect(outbox()).toHaveLength(1);
  expect(inbox()[0]?.processedAt).not.toBeNull();
  expect(inbox()[0]?.error).toBeNull();
});

test('gives up after the maximum attempts', async () => {
  deps.helix = {
    getChannels: async () => {
      throw new Error('helix down');
    },
  };
  const worker = createInboxWorker(deps);
  enqueue('m1', 'stream.online', { id: 's1', broadcaster_user_id: 'b1' });
  for (let i = 0; i < 5; i++) {
    await worker.drain();
    (deps.clock as FakeClock).advance(10 * 60_000);
  }
  expect(inbox()[0]?.error).toMatch(/helix down/);
  expect(inbox()[0]?.processedAt).not.toBeNull();
});

test('events for unknown broadcasters are ignored without Helix calls', async () => {
  let calls = 0;
  deps.helix = {
    getChannels: async () => {
      calls++;
      return [];
    },
  };
  const worker = createInboxWorker(deps);
  enqueue('m1', 'stream.online', { id: 's1', broadcaster_user_id: 'nobody' });
  enqueue('m2', 'channel.update', {
    broadcaster_user_id: 'nobody',
    title: 'x',
  });
  await worker.drain();
  expect(calls).toBe(0);
  expect(handle.db.select().from(liveState).all()).toEqual([]);
  expect(inbox().every((r) => r.processedAt !== null && r.error === null)).toBe(
    true,
  );
});

test('processing stream.online publishes a live-state bus event', async () => {
  const seen: unknown[] = [];
  deps.bus.subscribe((e) => {
    if (e.type === 'live-state') seen.push(e.payload);
  });
  const worker = createInboxWorker(deps);
  enqueue('m1', 'stream.online', { id: 's1', broadcaster_user_id: 'b1' });
  await worker.drain();
  expect(seen).toContainEqual(
    expect.objectContaining({
      broadcasterId: 'b1',
      live: true,
      streamId: 's1',
    }),
  );
});
