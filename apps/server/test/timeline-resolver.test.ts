import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import { categorySegments, streams } from '../src/db/schema.ts';
import { getRecordingSince } from '../src/db/settings.ts';
import { createBus } from '../src/events/bus.ts';
import { createLogger } from '../src/log.ts';
import type { BusEvent } from '../src/shared/events.ts';
import {
  queryRecordedCategories,
  queryStream,
  queryTimeline,
} from '../src/timeline/query.ts';
import {
  createVodResolver,
  resolveVods,
  type VodResolverDeps,
} from '../src/timeline/resolver.ts';
import { HelixError, type TwitchVideo } from '../src/twitch/helix.ts';
import { createFakeClock, type FakeClock } from './helpers/clock.ts';
import { createTestDb } from './helpers/db.ts';
import { seedStreamer } from './helpers/seed.ts';

const T0 = Date.parse('2026-01-15T17:00:00Z');
const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;

let handle: DbHandle;
let clock: FakeClock;
let deps: VodResolverDeps;
let videos: Map<string, TwitchVideo[]>;
let calls: string[];
let failFor: Set<string>;
let events: BusEvent[];
let logs: string[];

function video(streamId: string, userId: string): TwitchVideo {
  return {
    id: `v${streamId}`,
    streamId,
    userId,
    createdAt: new Date(T0 + 30_000).toISOString(),
    durationSeconds: 3 * 3600,
    type: 'archive',
    mutedSegments: [{ offset: 60, duration: 30 }],
  };
}

function addStream(streamId: string, broadcasterId: string, endedAt?: number) {
  handle.db
    .insert(streams)
    .values({ streamId, broadcasterId, startedAt: T0, endedAt })
    .run();
}

const row = (id: string) =>
  handle.db.select().from(streams).where(eq(streams.streamId, id)).get();

beforeEach(() => {
  handle = createTestDb();
  seedStreamer(handle.db, { id: 'b1' });
  clock = createFakeClock(T0 + 4 * H);
  videos = new Map();
  calls = [];
  failFor = new Set();
  events = [];
  logs = [];
  const bus = createBus();
  bus.subscribe((e) => events.push(e));
  deps = {
    db: handle.db,
    clock,
    bus,
    logger: createLogger({ level: 'debug', write: (l) => logs.push(l) }),
    helix: {
      getVideos: async (userId, opts) => {
        calls.push(`${userId}:${opts?.type}:${opts?.first}`);
        if (failFor.has(userId))
          throw new HelixError(500, '', 'Helix GET /videos failed (500)');
        return videos.get(userId) ?? [];
      },
    },
  };
});

afterEach(() => handle.close());

describe('resolveVods', () => {
  test('matches by stream id and stores the vod', async () => {
    addStream('s1', 'b1', T0 + 3 * H);
    videos.set('b1', [video('other', 'b1'), video('s1', 'b1')]);
    const r = await resolveVods(deps);
    expect(r).toEqual({ checked: 1, available: 1, none: 0 });
    expect(calls).toEqual(['b1:archive:100']);
    const s = row('s1');
    expect(s).toMatchObject({
      vodState: 'available',
      vodId: 'vs1',
      vodCreatedAt: T0 + 30_000,
      vodDurationS: 10800,
      vodCheckedAt: clock.now(),
    });
    expect(JSON.parse(s?.vodMuted ?? 'null')).toEqual([
      { offset: 60, duration: 30 },
    ]);
    expect(events).toEqual([{ type: 'timeline', payload: { streamId: 's1' } }]);
  });

  test('one call per broadcaster', async () => {
    addStream('s1', 'b1', T0 + H);
    addStream('s2', 'b1', T0 + 2 * H);
    addStream('s3', 'b2', T0 + 2 * H);
    videos.set('b1', [video('s1', 'b1'), video('s2', 'b1')]);
    await resolveVods(deps);
    expect(calls.sort()).toEqual(['b1:archive:100', 'b2:archive:100']);
    expect(row('s2')?.vodState).toBe('available');
    expect(row('s3')?.vodState).toBe('pending');
  });

  test('a live stream is matched', async () => {
    addStream('live', 'b1');
    videos.set('b1', [video('live', 'b1')]);
    await resolveVods(deps);
    expect(row('live')?.vodState).toBe('available');
  });

  test('no match within 7 days stays pending, rechecked at most hourly', async () => {
    addStream('s1', 'b1', T0 + 3 * H);
    await resolveVods(deps);
    expect(row('s1')).toMatchObject({
      vodState: 'pending',
      vodCheckedAt: clock.now(),
    });
    expect(events).toEqual([]);

    clock.advance(30 * MIN);
    await resolveVods(deps);
    expect(calls).toHaveLength(1);

    clock.advance(31 * MIN);
    await resolveVods(deps);
    expect(calls).toHaveLength(2);
    expect(row('s1')?.vodState).toBe('pending');
  });

  test('after 7 days without match it becomes none', async () => {
    addStream('s1', 'b1', T0 + 3 * H);
    clock.advance(7 * DAY);
    await resolveVods(deps);
    expect(row('s1')?.vodState).toBe('none');
    expect(events).toEqual([{ type: 'timeline', payload: { streamId: 's1' } }]);

    clock.advance(2 * H);
    await resolveVods(deps);
    expect(calls).toHaveLength(1);
  });

  test('a live stream never becomes none', async () => {
    addStream('live', 'b1');
    clock.advance(10 * DAY);
    await resolveVods(deps);
    expect(row('live')?.vodState).toBe('pending');
  });

  test('helix errors are swallowed and logged', async () => {
    addStream('s1', 'b1', T0 + H);
    addStream('s2', 'b2', T0 + H);
    failFor.add('b1');
    videos.set('b2', [video('s2', 'b2')]);
    await expect(resolveVods(deps)).resolves.toMatchObject({ available: 1 });
    expect(row('s1')).toMatchObject({
      vodState: 'pending',
      vodCheckedAt: null,
    });
    expect(row('s2')?.vodState).toBe('available');
    expect(logs.some((l) => l.includes('vod lookup failed'))).toBe(true);
  });

  test('picks at most 10 due streams', async () => {
    for (let i = 0; i < 12; i++) addStream(`s${i}`, 'b1', T0 + H);
    const r = await resolveVods(deps);
    expect(r.checked).toBe(10);
  });
});

describe('refresh of vods matched while live', () => {
  test('matched while live at 600 s, ended, refreshed, segment 2 h in links to ?t=2h', async () => {
    addStream('s1', 'b1');
    handle.db
      .insert(categorySegments)
      .values({
        streamId: 's1',
        broadcasterId: 'b1',
        categoryId: 'c1',
        categoryName: 'Game',
        startedAt: T0 + 2 * H + 30_000,
      })
      .run();
    clock.advance(T0 + 11 * MIN - clock.now());
    videos.set('b1', [
      { ...video('s1', 'b1'), durationSeconds: 600, mutedSegments: [] },
    ]);
    await resolveVods(deps);
    expect(row('s1')).toMatchObject({
      vodState: 'available',
      vodDurationS: 600,
    });

    // still live: rechecked at most hourly
    clock.advance(30 * MIN);
    await resolveVods(deps);
    expect(calls).toHaveLength(1);
    clock.advance(31 * MIN);
    videos.set('b1', [
      { ...video('s1', 'b1'), durationSeconds: 4000, mutedSegments: [] },
    ]);
    await resolveVods(deps);
    expect(calls).toHaveLength(2);
    expect(row('s1')?.vodDurationS).toBe(4000);

    // ended: one more refresh after the end, then never again
    handle.db
      .update(streams)
      .set({ endedAt: T0 + 3 * H })
      .where(eq(streams.streamId, 's1'))
      .run();
    clock.advance(T0 + 4 * H - clock.now());
    videos.set('b1', [
      {
        ...video('s1', 'b1'),
        durationSeconds: 3 * 3600 - 30,
        mutedSegments: [{ offset: 7200, duration: 60 }],
      },
    ]);
    await resolveVods(deps);
    expect(row('s1')).toMatchObject({ vodDurationS: 10770 });
    expect(JSON.parse(row('s1')?.vodMuted ?? 'null')).toEqual([
      { offset: 7200, duration: 60 },
    ]);
    clock.advance(2 * H);
    await resolveVods(deps);
    expect(calls).toHaveLength(3);

    const seg = queryStream(handle.db, 1, 's1', clock.now())?.segments[0];
    expect(seg?.link).toBe('https://www.twitch.tv/videos/vs1?t=2h0m0s');
    expect(seg?.muted).toBe(true);
  });

  test('a stale stored duration is clamped against the stream length', () => {
    handle.db
      .insert(streams)
      .values({
        streamId: 's1',
        broadcasterId: 'b1',
        startedAt: T0,
        endedAt: T0 + 3 * H,
        vodState: 'available',
        vodId: 'v1',
        vodCreatedAt: T0,
        vodDurationS: 600,
        vodCheckedAt: T0 + 3 * H + MIN,
      })
      .run();
    handle.db
      .insert(categorySegments)
      .values({
        streamId: 's1',
        broadcasterId: 'b1',
        categoryId: 'c1',
        startedAt: T0 + 2 * H,
      })
      .run();
    const seg = queryStream(handle.db, 1, 's1', clock.now())?.segments[0];
    expect(seg?.link).toBe('https://www.twitch.tv/videos/v1?t=2h0m0s');
  });

  test('pending streams are picked newest first', async () => {
    for (let i = 0; i < 12; i++)
      handle.db
        .insert(streams)
        .values({
          streamId: `s${i}`,
          broadcasterId: 'b1',
          startedAt: T0 + i * MIN,
          endedAt: T0 + H,
        })
        .run();
    await resolveVods(deps);
    expect(row('s0')?.vodCheckedAt).toBeNull();
    expect(row('s1')?.vodCheckedAt).toBeNull();
    expect(row('s11')?.vodCheckedAt).toBe(clock.now());
  });
});

describe('timeline queries', () => {
  test('recordedCategories uses the latest segment name', () => {
    addStream('s1', 'b1', T0 + H);
    handle.db
      .insert(categorySegments)
      .values([
        {
          streamId: 's1',
          broadcasterId: 'b1',
          categoryId: 'c1',
          categoryName: 'Zeta Old',
          startedAt: T0,
        },
        {
          streamId: 's1',
          broadcasterId: 'b1',
          categoryId: 'c1',
          categoryName: 'Alpha New',
          startedAt: T0 + MIN,
        },
      ])
      .run();
    expect(queryRecordedCategories(handle.db, 1)[0]?.name).toBe('Alpha New');
  });

  test('queryTimeline does not write recordingSince', () => {
    const before = getRecordingSince(handle.db);
    const page = queryTimeline(
      handle.db,
      { ownerId: 1, categoryId: 'c1', streamerIds: [], page: 1 },
      clock.now(),
    );
    expect(page.recordingSince).toBe(before ?? clock.now());
    expect(getRecordingSince(handle.db)).toBe(before);
  });
});

describe('createVodResolver', () => {
  test('does not overlap with itself', async () => {
    addStream('s1', 'b1', T0 + H);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const getVideos = deps.helix.getVideos;
    deps.helix = {
      getVideos: async (...args) => {
        await gate;
        return getVideos(...args);
      },
    };
    const resolver = createVodResolver(deps);
    const a = resolver.run();
    const b = resolver.run();
    expect(b).toBe(a);
    release();
    await a;
    expect(calls).toHaveLength(1);
  });

  test('trigger is debounced and stop cancels it', async () => {
    addStream('s1', 'b1', T0 + H);
    const resolver = createVodResolver({ ...deps, debounceMs: 20 });
    resolver.trigger();
    resolver.trigger();
    await new Promise((r) => setTimeout(r, 60));
    await resolver.inFlight();
    expect(calls).toHaveLength(1);

    resolver.trigger();
    resolver.stop();
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toHaveLength(1);
    await expect(resolver.run()).resolves.toBeUndefined();
  });
});
