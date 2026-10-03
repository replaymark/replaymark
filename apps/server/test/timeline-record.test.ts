import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import { categorySegments, streams } from '../src/db/schema.ts';
import { createBus } from '../src/events/bus.ts';
import { createLiveSync } from '../src/notify/live-sync.ts';
import { applyEvent, type EventsubDeps } from '../src/twitch/eventsub.ts';
import type { TwitchChannel, TwitchStream } from '../src/twitch/helix.ts';
import { createFakeClock, type FakeClock } from './helpers/clock.ts';
import { createTestDb } from './helpers/db.ts';
import {
  ELDEN_RING,
  JUST_CHATTING,
  MINECRAFT,
  seedStreamer,
} from './helpers/seed.ts';

const B = '1001';
const T0 = Date.parse('2026-01-15T17:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;

let handle: DbHandle;
let clock: FakeClock;
let deps: EventsubDeps;
let channel: { gameId: string; gameName: string; title: string } | null;
let helixStreams: TwitchStream[];

beforeEach(() => {
  handle = createTestDb();
  clock = createFakeClock(T0 + 10 * H);
  channel = { gameId: '', gameName: '', title: '' };
  helixStreams = [];
  deps = {
    db: handle.db,
    clock,
    bus: createBus(),
    timeZone: 'Europe/Berlin',
    helix: {
      getChannels: async (ids: readonly string[]): Promise<TwitchChannel[]> => {
        const c = channel;
        return c
          ? ids.map((id) => ({
              broadcasterId: id,
              broadcasterLogin: 'x',
              broadcasterName: 'x',
              ...c,
            }))
          : [];
      },
    },
  };
  seedStreamer(handle.db, { id: B, mode: 'any' });
});
afterEach(() => handle.close());

type Cat = { id: string; name: string };
const playing = (c: Cat) => {
  channel = { gameId: c.id, gameName: c.name, title: 't' };
};
const online = (id: string, startedAt = T0, receivedAt = startedAt + 2000) =>
  applyEvent(
    deps,
    'stream.online',
    {
      id,
      broadcaster_user_id: B,
      started_at: new Date(startedAt).toISOString(),
    },
    receivedAt,
  );
const update = (c: Cat, at: number, title = 't') =>
  applyEvent(
    deps,
    'channel.update',
    {
      broadcaster_user_id: B,
      category_id: c.id,
      category_name: c.name,
      title,
    },
    at,
  );
const offline = (at: number) =>
  applyEvent(deps, 'stream.offline', { broadcaster_user_id: B }, at);
const segs = () =>
  handle.db
    .select()
    .from(categorySegments)
    .orderBy(asc(categorySegments.startedAt), asc(categorySegments.id))
    .all()
    .map((s) => ({
      streamId: s.streamId,
      cat: s.categoryId,
      start: s.startedAt,
      end: s.endedAt,
      startApprox: s.startApprox,
      endApprox: s.endApprox,
    }));
const streamRows = () =>
  handle.db.select().from(streams).orderBy(asc(streams.startedAt)).all();
const sync = () =>
  createLiveSync({
    ...deps,
    helix: { getStreams: async () => helixStreams },
  })();
const helixLive = (id: string, c: Cat) => {
  helixStreams = [
    {
      id,
      userId: B,
      userLogin: 'x',
      userName: 'x',
      gameId: c.id,
      gameName: c.name,
      title: 't',
      startedAt: new Date(T0).toISOString(),
    },
  ];
};

describe('recordTransition via events', () => {
  test('switch after a long stream gives three segments', async () => {
    playing(JUST_CHATTING);
    await online('s1');
    const a = T0 + 9 * H;
    const b = a + 20 * MIN;
    const end = b + H;
    await update(ELDEN_RING, a);
    await update(JUST_CHATTING, b);
    await offline(end);
    expect(segs()).toEqual([
      expect.objectContaining({ cat: JUST_CHATTING.id, start: T0, end: a }),
      expect.objectContaining({ cat: ELDEN_RING.id, start: a, end: b }),
      expect.objectContaining({ cat: JUST_CHATTING.id, start: b, end }),
    ]);
    expect(streamRows()).toEqual([
      expect.objectContaining({
        streamId: 's1',
        broadcasterId: B,
        startedAt: T0,
        endedAt: end,
        endApprox: false,
      }),
    ]);
  });

  test('title-only change creates no segment', async () => {
    playing(ELDEN_RING);
    await online('s1');
    await update(ELDEN_RING, T0 + H, 'new title');
    expect(segs()).toHaveLength(1);
    expect(segs()[0]).toMatchObject({ start: T0, end: null });
  });

  test('offline category change creates no segment or stream', async () => {
    await update(ELDEN_RING, T0);
    expect(segs()).toEqual([]);
    expect(streamRows()).toEqual([]);
  });

  test('retried event keeps its receive time as boundary', async () => {
    playing(JUST_CHATTING);
    await online('s1');
    const received = Date.parse('2026-01-15T20:00:00Z');
    // processed later (clock is past 20:01:30), but receivedAt is what counts
    await update(ELDEN_RING, received);
    expect(segs()[0]?.end).toBe(received);
    expect(segs()[1]?.start).toBe(received);
    // a replay of the same event changes nothing
    await update(ELDEN_RING, received);
    expect(segs()).toHaveLength(2);
  });

  test('stale category from the previous stream is not recorded', async () => {
    playing(ELDEN_RING);
    await online('s1');
    await offline(T0 + H);
    // channel fetch fails: live_state still holds ELDEN_RING from s1
    channel = null;
    const t1 = T0 + 5 * H;
    await online('s2', t1);
    expect(segs().filter((s) => s.streamId === 's2')).toEqual([]);
    // the first confirmed category opens the segment at its event time (the
    // category at stream start is unknown), even when it equals the stale one
    await update(ELDEN_RING, t1 + 5 * MIN);
    expect(segs().filter((s) => s.streamId === 's2')).toEqual([
      expect.objectContaining({
        cat: ELDEN_RING.id,
        start: t1 + 5 * MIN,
        end: null,
      }),
    ]);
  });

  test('failed channel fetch: a later channel.update opens at its own time', async () => {
    channel = null;
    await online('s1');
    await update(MINECRAFT, T0 + 30_000);
    expect(segs()).toEqual([
      expect.objectContaining({
        cat: MINECRAFT.id,
        start: T0 + 30_000,
        end: null,
      }),
    ]);
  });

  test('stream online without category: a later category is not backdated', async () => {
    await online('s1');
    expect(segs()).toEqual([]);
    const a = T0 + 2 * H;
    await update(ELDEN_RING, a);
    expect(segs()).toEqual([
      expect.objectContaining({ cat: ELDEN_RING.id, start: a, end: null }),
    ]);
  });

  test('stream reported live again after being closed is reopened', async () => {
    playing(ELDEN_RING);
    await online('s1');
    // paused mid-stream: the admin closes the timeline
    const closedAt = T0 + H;
    handle.db
      .update(streams)
      .set({ endedAt: closedAt, endApprox: true })
      .where(eq(streams.streamId, 's1'))
      .run();
    handle.db
      .update(categorySegments)
      .set({ endedAt: closedAt, endApprox: true })
      .run();
    const at = T0 + 2 * H;
    await update(MINECRAFT, at);
    expect(streamRows()[0]).toMatchObject({ endedAt: null, endApprox: false });
    expect(segs()).toEqual([
      expect.objectContaining({ cat: ELDEN_RING.id, end: closedAt }),
      expect.objectContaining({
        cat: MINECRAFT.id,
        start: at,
        end: null,
        startApprox: true,
      }),
    ]);
  });

  test('publishes a timeline event for every touched stream', async () => {
    playing(ELDEN_RING);
    await online('s1');
    // a leftover open stream the live_state no longer points to
    handle.db
      .insert(streams)
      .values({ streamId: 'old', broadcasterId: B, startedAt: T0 - H })
      .run();
    const published: string[] = [];
    deps.bus.subscribe((e) => {
      if (e.type === 'timeline') published.push(e.payload.streamId);
    });
    await online('s2', T0 + 3 * H);
    expect([...new Set(published)].sort()).toEqual(['old', 's1', 's2']);
  });

  test('retried stream.online is idempotent', async () => {
    playing(ELDEN_RING);
    await online('s1');
    await online('s1');
    expect(streamRows()).toHaveLength(1);
    expect(segs()).toHaveLength(1);
  });

  test('new stream id closes the old stream at the new start', async () => {
    playing(ELDEN_RING);
    await online('s1');
    const t1 = T0 + 3 * H;
    playing(MINECRAFT);
    await online('s2', t1);
    const [s1, s2] = streamRows();
    // the missed offline makes the end only an upper bound
    expect(s1).toMatchObject({ streamId: 's1', endedAt: t1, endApprox: true });
    expect(s2).toMatchObject({ streamId: 's2', startedAt: t1, endedAt: null });
    expect(segs()).toEqual([
      expect.objectContaining({
        streamId: 's1',
        start: T0,
        end: t1,
        endApprox: true,
      }),
      expect.objectContaining({ streamId: 's2', start: t1, end: null }),
    ]);
  });

  test('out-of-order event does not create overlapping segments', async () => {
    playing(JUST_CHATTING);
    await online('s1');
    await update(ELDEN_RING, T0 + 2 * H);
    // an older event processed later
    await update(MINECRAFT, T0 + H);
    expect(segs()).toEqual([
      expect.objectContaining({ cat: JUST_CHATTING.id, end: T0 + 2 * H }),
      expect.objectContaining({
        cat: ELDEN_RING.id,
        start: T0 + 2 * H,
        end: null,
      }),
    ]);
  });

  test('unknown broadcaster is not recorded', async () => {
    await applyEvent(
      deps,
      'stream.online',
      {
        id: 'x',
        broadcaster_user_id: '999',
        started_at: '2026-01-15T17:00:00Z',
      },
      T0,
    );
    expect(streamRows()).toEqual([]);
  });
});

describe('recordTransition via live sync', () => {
  test('missed offline ends the stream approximately', async () => {
    playing(ELDEN_RING);
    await online('s1');
    clock.advance(H);
    await sync();
    expect(streamRows()[0]).toMatchObject({
      endedAt: clock.now(),
      endApprox: true,
    });
    expect(segs()[0]).toMatchObject({ end: clock.now(), endApprox: true });
  });

  test('category changed during downtime closes and opens at sync time', async () => {
    playing(JUST_CHATTING);
    await online('s1');
    clock.advance(H);
    helixLive('s1', ELDEN_RING);
    await sync();
    const now = clock.now();
    expect(segs()).toEqual([
      expect.objectContaining({
        cat: JUST_CHATTING.id,
        end: now,
        endApprox: true,
      }),
      expect.objectContaining({
        cat: ELDEN_RING.id,
        start: now,
        end: null,
        startApprox: true,
      }),
    ]);
  });

  test('stream first seen by sync starts its segment at sync time', async () => {
    helixLive('s1', ELDEN_RING);
    await sync();
    expect(streamRows()[0]).toMatchObject({ startedAt: T0 });
    expect(segs()).toEqual([
      expect.objectContaining({ start: clock.now(), startApprox: true }),
    ]);
    // an unchanged sync writes nothing new
    clock.advance(MIN);
    await sync();
    expect(segs()).toHaveLength(1);
  });
});
