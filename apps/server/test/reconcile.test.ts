import { afterEach, describe, expect, test, vi } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import { subscriptions } from '../src/db/schema.ts';
import { getMeta, setSetting } from '../src/db/settings.ts';
import { createBus } from '../src/events/bus.ts';
import type { Logger } from '../src/log.ts';
import type { BusEvent, SyncResult } from '../src/shared/events.ts';
import {
  type CreateSubscriptionInput,
  createHelix,
  HELIX_BASE,
  type TwitchSubscription,
} from '../src/twitch/helix.ts';
import { createReconciler, DEBOUNCE_MS } from '../src/twitch/reconcile.ts';
import { createFakeClock } from './helpers/clock.ts';
import { createTestDb } from './helpers/db.ts';
import { createFakeFetch, json } from './helpers/fetch.ts';
import { seedStreamer, seedUser } from './helpers/seed.ts';

const CB = 'https://example.test/webhook';
const SECRET = 'secret-0123456789';

let handle: DbHandle | undefined;
afterEach(() => {
  handle?.close();
  handle = undefined;
  vi.useRealTimers();
});

function sub(
  id: string,
  type: string,
  broadcaster: string,
  status = 'enabled',
  callback = CB,
): TwitchSubscription {
  return {
    id,
    status,
    type,
    version: type === 'channel.update' ? '2' : '1',
    condition: { broadcaster_user_id: broadcaster },
    callback,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function fullSet(b: string, prefix = b): TwitchSubscription[] {
  return [
    sub(`${prefix}-on`, 'stream.online', b),
    sub(`${prefix}-off`, 'stream.offline', b),
    sub(`${prefix}-up`, 'channel.update', b),
  ];
}

function setup(
  opts: {
    remote?: TwitchSubscription[];
    streamers?: { id: string; enabled?: boolean }[];
    failCreate?: (i: CreateSubscriptionInput) => boolean;
  } = {},
) {
  handle = createTestDb();
  const db = handle.db;
  for (const s of opts.streamers ?? []) {
    seedStreamer(db, {
      id: s.id,
      login: `l${s.id}`,
      displayName: `D${s.id}`,
      enabled: s.enabled,
    });
  }
  const remote = [...(opts.remote ?? [])];
  const created: CreateSubscriptionInput[] = [];
  const deleted: string[] = [];
  let n = 0;
  const helix = {
    listSubscriptions: vi.fn(async () => [...remote]),
    createSubscription: vi.fn(async (i: CreateSubscriptionInput) => {
      if (opts.failCreate?.(i)) throw new Error('boom');
      created.push(i);
      return `new${++n}`;
    }),
    deleteSubscription: vi.fn(async (id: string) => {
      deleted.push(id);
    }),
  };
  const bus = createBus();
  const events: BusEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const logs: string[] = [];
  const logger: Logger = {
    debug: () => {},
    info: (m) => logs.push(m),
    warn: (m) => logs.push(m),
    error: (m) => logs.push(m),
  };
  const liveSync = vi.fn(async () => {});
  const clock = createFakeClock();
  const rec = createReconciler({
    db,
    helix,
    clock,
    logger,
    bus,
    callbackUrl: CB,
    webhookSecret: SECRET,
    liveSync,
  });
  return { db, rec, helix, created, deleted, events, logs, liveSync };
}

describe('reconcile run', () => {
  test('verification racing ahead of the mirror write keeps enabled', async () => {
    const t = setup({ streamers: [{ id: '1' }] });
    let n = 0;
    t.helix.createSubscription.mockImplementation(async () => {
      const id = `early${++n}`;
      // Simulates the webhook handler enabling the row before create returns.
      t.db
        .insert(subscriptions)
        .values({
          twitchSubId: id,
          type: 'stream.online',
          version: '1',
          broadcasterId: '1',
          status: 'enabled',
          createdAt: 0,
          updatedAt: 0,
        })
        .run();
      return id;
    });
    await t.rec.run();
    const rows = t.db.select().from(subscriptions).all();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'enabled')).toBe(true);
  });

  test('creates three subscriptions per active streamer', async () => {
    const t = setup({ streamers: [{ id: '1' }, { id: '2', enabled: false }] });
    const r = await t.rec.run();
    expect(t.created).toEqual([
      {
        type: 'stream.online',
        version: '1',
        broadcasterId: '1',
        callback: CB,
        secret: SECRET,
      },
      {
        type: 'stream.offline',
        version: '1',
        broadcasterId: '1',
        callback: CB,
        secret: SECRET,
      },
      {
        type: 'channel.update',
        version: '2',
        broadcasterId: '1',
        callback: CB,
        secret: SECRET,
      },
    ]);
    expect(r).toMatchObject({ ok: true, active: 3, created: 3, deleted: 0 });
    expect(t.liveSync).toHaveBeenCalledOnce();
  });

  test('deletes subs of paused and removed streamers', async () => {
    const t = setup({
      streamers: [{ id: '1', enabled: false }],
      remote: [...fullSet('1'), ...fullSet('9')],
    });
    const r = await t.rec.run();
    expect(t.deleted.sort()).toEqual(
      ['1-on', '1-off', '1-up', '9-on', '9-off', '9-up'].sort(),
    );
    expect(t.created).toEqual([]);
    expect(r).toMatchObject({ active: 0, deleted: 6 });
    expect(t.db.select().from(subscriptions).all()).toEqual([]);
  });

  test('paused for one account only keeps the subscriptions', async () => {
    const t = setup({ remote: fullSet('1') });
    seedStreamer(t.db, { id: '1', enabled: false });
    seedStreamer(t.db, { id: '1', ownerId: seedUser(t.db, 'tom') });
    const r = await t.rec.run();
    expect(t.deleted).toEqual([]);
    expect(t.created).toEqual([]);
    expect(r).toMatchObject({ active: 3, created: 0, deleted: 0 });
  });

  test('replaces failed subs, keeps verification pending', async () => {
    const t = setup({
      streamers: [{ id: '1' }],
      remote: [
        sub('a', 'stream.online', '1', 'notification_failures_exceeded'),
        sub(
          'b',
          'stream.offline',
          '1',
          'webhook_callback_verification_pending',
        ),
        sub('c', 'channel.update', '1'),
      ],
    });
    await t.rec.run();
    expect(t.deleted).toEqual(['a']);
    expect(t.created.map((c) => c.type)).toEqual(['stream.online']);
  });

  test('removes duplicates preferring enabled; ignores foreign callback', async () => {
    const t = setup({
      streamers: [{ id: '1' }],
      remote: [
        sub('p', 'stream.online', '1', 'webhook_callback_verification_pending'),
        sub('e', 'stream.online', '1'),
        sub('x', 'stream.offline', '1', 'enabled', 'https://other.test/cb'),
        sub('f', 'stream.offline', '1'),
        sub('g', 'channel.update', '1'),
      ],
    });
    const r = await t.rec.run();
    expect(t.deleted).toEqual(['p']);
    expect(t.created).toEqual([]);
    expect(r).toMatchObject({ ok: true, active: 3, deleted: 1, created: 0 });
    const ids = t.db
      .select()
      .from(subscriptions)
      .all()
      .map((s) => s.twitchSubId)
      .sort();
    expect(ids).toEqual(['e', 'f', 'g']);
  });

  test('partial create failure continues and records error', async () => {
    const t = setup({
      streamers: [{ id: '1' }],
      failCreate: (i) => i.type === 'stream.offline',
    });
    const r = await t.rec.run();
    expect(t.created.map((c) => c.type)).toEqual([
      'stream.online',
      'channel.update',
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('boom');
    expect(getMeta<SyncResult>(t.db, 'last_sync')?.ok).toBe(false);
  });

  test('listing failure reports the stored active count', async () => {
    const t = setup({ streamers: [{ id: '1' }] });
    await t.rec.run();
    t.helix.listSubscriptions.mockRejectedValueOnce(new Error('list down'));
    t.events.length = 0;
    const r = await t.rec.run();
    expect(r).toMatchObject({ ok: false, active: 3 });
    expect(t.events.find((e) => e.type === 'subscriptions')?.payload).toEqual({
      active: 3,
    });
  });

  test('liveSync error is collected', async () => {
    const t = setup();
    t.liveSync.mockRejectedValueOnce(new Error('streams down'));
    const r = await t.rec.run();
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('streams down');
  });

  test('writes app_meta, mirror, log and bus events', async () => {
    const t = setup({
      streamers: [{ id: '1' }],
      remote: [sub('k', 'stream.online', '1')],
    });
    const r = await t.rec.run('startup');
    expect(getMeta(t.db, 'last_sync')).toEqual(r);
    expect(
      t.logs.some((l) => l.includes('3 active, 2 created, 0 deleted')),
    ).toBe(true);
    const rows = t.db.select().from(subscriptions).all();
    expect(
      rows
        .map((x) => [x.twitchSubId, x.type, x.broadcasterId, x.status])
        .sort(),
    ).toEqual([
      ['k', 'stream.online', '1', 'enabled'],
      ['new1', 'stream.offline', '1', 'webhook_callback_verification_pending'],
      ['new2', 'channel.update', '1', 'webhook_callback_verification_pending'],
    ]);
    expect(t.events.map((e) => e.type)).toEqual([
      'sync',
      'subscriptions',
      'sync',
    ]);
    expect(t.events[0]).toEqual({
      type: 'sync',
      payload: { phase: 'start', reason: 'startup' },
    });
    expect(t.events[2]).toEqual({
      type: 'sync',
      payload: { phase: 'end', reason: 'startup', result: r },
    });
  });

  test('follows pagination through the real helix client', async () => {
    handle = createTestDb();
    const f = createFakeFetch();
    const page = (subs: TwitchSubscription[], cursor?: string) =>
      json({
        data: subs.map((s) => ({
          id: s.id,
          status: s.status,
          type: s.type,
          version: s.version,
          condition: s.condition,
          transport: { method: 'webhook', callback: s.callback },
          created_at: s.createdAt,
        })),
        pagination: cursor ? { cursor } : {},
      });
    const all = fullSet('1');
    f.on(
      `${HELIX_BASE}/eventsub/subscriptions`,
      page(all.slice(0, 2), 'c1'),
      page(all.slice(2)),
    );
    const clock = createFakeClock();
    const helix = createHelix({
      clientId: 'cid',
      token: { getToken: async () => 't', invalidate: () => {} },
      fetch: f.fetch,
      clock,
    });
    seedStreamer(handle.db, { id: '1', login: 'a', displayName: 'A' });
    const rec = createReconciler({
      db: handle.db,
      helix,
      clock,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      bus: createBus(),
      callbackUrl: CB,
      webhookSecret: SECRET,
      liveSync: async () => {},
    });
    const r = await rec.run();
    expect(f.requests).toHaveLength(2);
    expect(f.requests[1]?.url).toContain('after=c1');
    expect(r).toMatchObject({ ok: true, active: 3, created: 0, deleted: 0 });
  });
});

describe('reconcile scheduling', () => {
  test('three triggers during a run cause exactly one follow-up', async () => {
    const t = setup();
    let release!: () => void;
    t.helix.listSubscriptions.mockImplementationOnce(
      () =>
        new Promise((res) => {
          release = () => res([]);
        }),
    );
    const first = t.rec.request('a');
    const others = [t.rec.request('b'), t.rec.request('c'), t.rec.request('d')];
    await Promise.resolve();
    release();
    await Promise.all([first, ...others]);
    expect(t.helix.listSubscriptions).toHaveBeenCalledTimes(2);
  });

  test('request never throws', async () => {
    const t = setup();
    t.helix.listSubscriptions.mockRejectedValueOnce(new Error('down'));
    await expect(t.rec.request('x')).resolves.toBeUndefined();
    expect(getMeta<SyncResult>(t.db, 'last_sync')?.ok).toBe(false);
  });

  test('debounce coalesces triggers', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.rec.requestDebounced('a');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    t.rec.requestDebounced('b');
    t.rec.requestDebounced('c');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(t.helix.listSubscriptions).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.helix.listSubscriptions).toHaveBeenCalledOnce();
    t.rec.stop();
  });

  test('interval uses syncIntervalHours, re-read after each run', async () => {
    vi.useFakeTimers();
    const t = setup();
    setSetting(t.db, 'syncIntervalHours', 1);
    t.rec.startInterval();
    setSetting(t.db, 'syncIntervalHours', 2);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(t.helix.listSubscriptions).toHaveBeenCalledOnce();
    // Re-armed after the run finished: nothing within 1 h, next one at 2 h.
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(t.helix.listSubscriptions).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(t.helix.listSubscriptions).toHaveBeenCalledTimes(2);
    t.rec.stop();
  });
});
