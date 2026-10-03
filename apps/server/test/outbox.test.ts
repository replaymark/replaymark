import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import { mailOutbox } from '../src/db/schema.ts';
import { createBus } from '../src/events/bus.ts';
import {
  createOutboxWorker,
  type OutboxWorker,
} from '../src/jobs/outbox-worker.ts';
import type { Logger } from '../src/log.ts';
import { createMailer, type MailMessage } from '../src/mail/mailer.ts';
import type { BusEvent } from '../src/shared/events.ts';
import { createFakeClock, type FakeClock } from './helpers/clock.ts';
import { createTestDb } from './helpers/db.ts';
import { OWNER_ID } from './helpers/seed.ts';

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
let handle: DbHandle;
let clock: FakeClock;
let worker: OutboxWorker;
let sent: MailMessage[];
let failNext: number;
let events: BusEvent[];

function insert(status: 'pending' | 'failed' | 'sent' = 'pending'): number {
  return handle.db
    .insert(mailOutbox)
    .values({
      ownerId: OWNER_ID,
      streamId: 's1',
      broadcasterId: 'b1',
      categoryId: 'c1',
      payload: JSON.stringify({
        subject: 'Live',
        text: 't',
        html: '<p>t</p>',
        recipients: ['a@x.de'],
      }),
      nextAttemptAt: clock.now(),
      status,
      createdAt: clock.now(),
      updatedAt: clock.now(),
      sentAt: status === 'sent' ? clock.now() : null,
    })
    .returning({ id: mailOutbox.id })
    .get().id;
}

const row = (id: number) =>
  handle.db.select().from(mailOutbox).where(eq(mailOutbox.id, id)).get();

beforeEach(() => {
  handle = createTestDb();
  clock = createFakeClock();
  sent = [];
  failNext = 0;
  events = [];
  const bus = createBus();
  bus.subscribe((e) => events.push(e));
  const transport = {
    sendMail: async (msg: MailMessage) => {
      if (failNext > 0) {
        failNext--;
        throw new Error('smtp down');
      }
      sent.push(msg);
    },
  };
  worker = createOutboxWorker({
    db: handle.db,
    mailer: createMailer({ transport, from: 'ss@x.de' }),
    clock,
    logger,
    bus,
  });
});
afterEach(() => {
  worker.stop();
  handle.close();
});

test('failure backs off, then succeeds once due', async () => {
  const id = insert();
  failNext = 1;
  await worker.processDue();
  const r = row(id);
  expect(r?.attempts).toBe(1);
  expect(r?.lastError).toBe('smtp down');
  expect(r?.status).toBe('pending');
  expect(r?.nextAttemptAt).toBe(clock.now() + 60_000);
  expect(r?.updatedAt).toBe(clock.now());
  expect(r?.sentAt).toBeNull();

  clock.advance(59_999);
  await worker.processDue();
  expect(sent).toHaveLength(0);

  clock.advance(1);
  await worker.processDue();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.to).toEqual(['a@x.de']);
  expect(row(id)?.status).toBe('sent');
  expect(row(id)?.sentAt).toBe(clock.now());
  expect(row(id)?.updatedAt).toBe(clock.now());
  expect(events).toContainEqual({
    type: 'notification',
    payload: expect.objectContaining({
      status: 'sent',
      outboxId: id,
      ownerId: OWNER_ID,
      broadcasterId: 'b1',
    }),
  });
});

test('three failures mark the row failed; retry re-queues it', async () => {
  const id = insert();
  failNext = 3;
  await worker.processDue();
  clock.advance(60_000);
  await worker.processDue();
  expect(row(id)?.attempts).toBe(2);
  expect(row(id)?.nextAttemptAt).toBe(clock.now() + 300_000);
  clock.advance(299_999);
  await worker.processDue();
  expect(row(id)?.attempts).toBe(2);
  clock.advance(1);
  await worker.processDue();
  expect(row(id)?.status).toBe('failed');
  expect(row(id)?.attempts).toBe(3);
  expect(events.map((e) => e.payload)).toContainEqual(
    expect.objectContaining({ status: 'failed', outboxId: id }),
  );

  expect(worker.retry(id)).toBe(true);
  const r = row(id);
  expect(r?.status).toBe('pending');
  expect(r?.attempts).toBe(0);
  expect(r?.lastError).toBe('smtp down');
  expect(r?.nextAttemptAt).toBe(clock.now());
  expect(r?.updatedAt).toBe(clock.now());
  expect(r?.sentAt).toBeNull();
  await worker.processDue();
  expect(row(id)?.status).toBe('sent');
});

test('retry only applies to failed rows', () => {
  expect(worker.retry(insert('pending'))).toBe(false);
  expect(worker.retry(insert('sent'))).toBe(false);
  expect(worker.retry(9999)).toBe(false);
});

test('processes due rows oldest first and inFlight resolves', async () => {
  const a = insert();
  clock.advance(1);
  const b = insert();
  worker.wake();
  await worker.inFlight();
  expect(row(a)?.status).toBe('sent');
  expect(row(b)?.status).toBe('sent');
  expect(
    events.map((e) => (e.payload as { outboxId?: number }).outboxId),
  ).toEqual([a, b]);
});

test('wake is a no-op after stop', async () => {
  const id = insert();
  worker.stop();
  worker.wake();
  await worker.inFlight();
  expect(sent).toHaveLength(0);
  expect(row(id)?.status).toBe('pending');
});
