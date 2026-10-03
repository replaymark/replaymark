import { afterEach, describe, expect, it } from 'vitest';
import { categorySegments, streams } from '../src/db/schema.ts';
import { getRecordingSince } from '../src/db/settings.ts';
import type {
  RecordedCategory,
  StreamDetail,
  TimelinePage,
} from '../src/shared/schemas.ts';
import {
  type AdminHarness,
  createAdminHarness,
  followAs,
  seedAccount,
} from './helpers/admin.ts';
import {
  ELDEN_RING,
  JUST_CHATTING,
  MINECRAFT,
  seedCategory,
  seedStreamer,
} from './helpers/seed.ts';

const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
// Fake clock starts at 2023-11-14T22:13:20Z.
const D1 = Date.parse('2023-11-01T18:00:00Z');

let h: AdminHarness | undefined;
afterEach(() => {
  h?.handle.close();
  h = undefined;
});

function setup() {
  h = createAdminHarness();
  const db = h.handle.db;
  seedStreamer(db, { id: '1', login: 'alice', displayName: 'Alice' });
  seedStreamer(db, { id: '2', login: 'bob', displayName: 'Bob' });
  seedCategory(db, ELDEN_RING, 'https://box/er-{width}x{height}.jpg');
  return h;
}

function addStream(
  t: AdminHarness,
  s: {
    id: string;
    by: string;
    start: number;
    end?: number | null;
    vod?: { id: string; createdAt: number; durationS: number; muted?: unknown };
    segs: {
      cat: { id: string; name: string };
      from: number;
      to: number | null;
      approx?: boolean;
    }[];
  },
) {
  const db = t.handle.db;
  db.insert(streams)
    .values({
      streamId: s.id,
      broadcasterId: s.by,
      startedAt: s.start,
      endedAt: s.end === undefined ? s.start + 5 * H : s.end,
      vodId: s.vod?.id ?? null,
      vodCreatedAt: s.vod?.createdAt ?? null,
      vodDurationS: s.vod?.durationS ?? null,
      vodMuted: s.vod?.muted ? JSON.stringify(s.vod.muted) : null,
      vodState: s.vod ? 'available' : 'pending',
    })
    .run();
  for (const g of s.segs)
    db.insert(categorySegments)
      .values({
        streamId: s.id,
        broadcasterId: s.by,
        categoryId: g.cat.id,
        categoryName: g.cat.name,
        startedAt: g.from,
        endedAt: g.to,
        startApprox: g.approx ?? false,
      })
      .run();
}

async function get<T>(t: AdminHarness, path: string) {
  const res = await t.req(path);
  return { status: res.status, body: (await res.json()) as T };
}

describe('GET /api/timeline', () => {
  it('returns the persisted recording start date', async () => {
    const t = setup();
    const since = getRecordingSince(t.handle.db);
    expect(since).toBeTypeOf('number');
    const { status, body } = await get<TimelinePage>(
      t,
      `/api/timeline?categoryId=${ELDEN_RING.id}`,
    );
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.recordingSince).toBe(since);
  });

  it('filters by category, newest first, all segments with the queried ones flagged, with links', async () => {
    const t = setup();
    addStream(t, {
      id: 's1',
      by: '1',
      start: D1,
      vod: {
        id: 'v1',
        createdAt: D1 + 5_000,
        durationS: 5 * 3600,
        muted: [{ offset: 7200, duration: 60 }],
      },
      segs: [
        { cat: ELDEN_RING, from: D1, to: D1 + H },
        { cat: JUST_CHATTING, from: D1 + H, to: D1 + 2 * H },
        { cat: ELDEN_RING, from: D1 + 2 * H, to: D1 + 3 * H },
      ],
    });
    addStream(t, {
      id: 's2',
      by: '2',
      start: D1 + DAY,
      segs: [{ cat: ELDEN_RING, from: D1 + DAY, to: D1 + DAY + H }],
    });
    addStream(t, {
      id: 's3',
      by: '2',
      start: D1 + 2 * DAY,
      segs: [{ cat: MINECRAFT, from: D1 + 2 * DAY, to: null }],
    });

    const { status, body } = await get<TimelinePage>(
      t,
      `/api/timeline?categoryId=${ELDEN_RING.id}`,
    );
    expect(status).toBe(200);
    expect(body.items.map((s) => s.streamId)).toEqual(['s2', 's1']);
    expect(body.hasMore).toBe(false);
    const [s2, s1] = body.items;
    expect(s2?.vodState).toBe('pending');
    expect(s2?.vodUrl).toBeNull();
    expect(s2?.segments[0]?.link).toBeNull();
    expect(s2?.broadcaster).toEqual({
      id: '2',
      login: 'bob',
      displayName: 'Bob',
      avatarUrl: null,
    });
    expect(s1?.vodUrl).toBe('https://www.twitch.tv/videos/v1');
    expect(s1?.segments).toHaveLength(3);
    expect(s1?.segments.map((g) => g.match)).toEqual([true, false, true]);
    expect(s1?.segments[0]).toMatchObject({
      categoryName: 'Elden Ring',
      boxArtUrl: 'https://box/er-{width}x{height}.jpg',
      durationMs: H,
      muted: false,
      link: 'https://www.twitch.tv/videos/v1',
    });
    expect(s1?.segments[2]).toMatchObject({
      muted: true,
      link: 'https://www.twitch.tv/videos/v1?t=1h59m55s',
    });
  });

  it('filters by streamers and inclusive date range', async () => {
    const t = setup();
    for (let i = 0; i < 4; i++)
      addStream(t, {
        id: `a${i}`,
        by: '1',
        start: D1 + i * DAY,
        segs: [{ cat: ELDEN_RING, from: D1 + i * DAY, to: D1 + i * DAY + H }],
      });
    addStream(t, {
      id: 'b1',
      by: '2',
      start: D1 + DAY,
      segs: [{ cat: ELDEN_RING, from: D1 + DAY, to: D1 + DAY + H }],
    });
    const q = `/api/timeline?categoryId=${ELDEN_RING.id}`;
    const onlyA = await get<TimelinePage>(t, `${q}&streamerIds=1`);
    expect(onlyA.body.items.map((s) => s.streamId)).toEqual([
      'a3',
      'a2',
      'a1',
      'a0',
    ]);
    const range = await get<TimelinePage>(
      t,
      `${q}&streamerIds=1,2&from=${D1 + DAY}&to=${D1 + 2 * DAY}`,
    );
    expect(range.body.items.map((s) => s.streamId).sort()).toEqual([
      'a1',
      'a2',
      'b1',
    ]);
  });

  it('paginates 20 per page with hasMore', async () => {
    const t = setup();
    for (let i = 0; i < 21; i++)
      addStream(t, {
        id: `p${String(i).padStart(2, '0')}`,
        by: '1',
        start: D1 - i * H * 6,
        segs: [{ cat: ELDEN_RING, from: D1 - i * H * 6, to: null }],
        end: null,
      });
    const q = `/api/timeline?categoryId=${ELDEN_RING.id}`;
    const p1 = await get<TimelinePage>(t, q);
    expect(p1.body.items).toHaveLength(20);
    expect(p1.body.hasMore).toBe(true);
    expect(p1.body.items[0]?.live).toBe(true);
    // Open segments count up to now.
    expect(p1.body.items[0]?.segments[0]?.durationMs).toBe(t.clock.now() - D1);
    const p2 = await get<TimelinePage>(t, `${q}&page=2`);
    expect(p2.body.items.map((s) => s.streamId)).toEqual(['p20']);
    expect(p2.body.hasMore).toBe(false);
  });

  it('paginates without categoryId', async () => {
    const t = setup();
    for (let i = 0; i < 21; i++)
      addStream(t, {
        id: `n${String(i).padStart(2, '0')}`,
        by: '1',
        start: D1 - i * H * 6,
        segs: [{ cat: ELDEN_RING, from: D1 - i * H * 6, to: null }],
        end: null,
      });
    const p1 = await get<TimelinePage>(t, '/api/timeline');
    expect(p1.body.items).toHaveLength(20);
    expect(p1.body.hasMore).toBe(true);
    const p2 = await get<TimelinePage>(t, '/api/timeline?page=2');
    expect(p2.body.items.map((s) => s.streamId)).toEqual(['n20']);
    expect(p2.body.hasMore).toBe(false);
  });

  it('without categoryId lists recent streams of all games, none flagged', async () => {
    const t = setup();
    addStream(t, {
      id: 's1',
      by: '1',
      start: D1,
      segs: [{ cat: ELDEN_RING, from: D1, to: D1 + H }],
    });
    addStream(t, {
      id: 's2',
      by: '2',
      start: D1 + DAY,
      segs: [
        { cat: MINECRAFT, from: D1 + DAY, to: D1 + DAY + H },
        { cat: JUST_CHATTING, from: D1 + DAY + H, to: null },
      ],
    });
    const { status, body } = await get<TimelinePage>(t, '/api/timeline');
    expect(status).toBe(200);
    expect(body.items.map((s) => s.streamId)).toEqual(['s2', 's1']);
    expect(body.items[0]?.segments).toHaveLength(2);
    expect(body.items.flatMap((s) => s.segments).some((g) => g.match)).toBe(
      false,
    );
  });

  it('flags both segments when a game is played twice in one stream', async () => {
    const t = setup();
    addStream(t, {
      id: 's1',
      by: '1',
      start: D1,
      segs: [
        { cat: ELDEN_RING, from: D1, to: D1 + H },
        { cat: MINECRAFT, from: D1 + H, to: D1 + 2 * H },
        { cat: ELDEN_RING, from: D1 + 2 * H, to: D1 + 3 * H },
      ],
    });
    const { body } = await get<TimelinePage>(
      t,
      `/api/timeline?categoryId=${ELDEN_RING.id}`,
    );
    expect(body.items[0]?.segments.filter((g) => g.match)).toHaveLength(2);
  });

  it('400 for an empty categoryId', async () => {
    const t = setup();
    const res = await get<{ error: { code: string; fields: object } }>(
      t,
      '/api/timeline?categoryId=',
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.fields).toHaveProperty('categoryId');
  });

  it('treats the bounds as inclusive epoch ms', async () => {
    const t = setup();
    addStream(t, {
      id: 'e1',
      by: '1',
      start: D1,
      segs: [{ cat: ELDEN_RING, from: D1, to: D1 + H }],
    });
    const q = `/api/timeline?categoryId=${ELDEN_RING.id}`;
    const at = await get<TimelinePage>(t, `${q}&from=${D1}&to=${D1}`);
    expect(at.body.items.map((s) => s.streamId)).toEqual(['e1']);
    const after = await get<TimelinePage>(t, `${q}&from=${D1 + 1}`);
    expect(after.body.items).toEqual([]);
    const before = await get<TimelinePage>(t, `${q}&to=${D1 - 1}`);
    expect(before.body.items).toEqual([]);
  });

  it.each([
    ['from=2023-11-02', 'from'],
    ['from=-1', 'from'],
    ['to=1.5', 'to'],
    ['from=2000&to=1000', 'to'],
  ])('400 on bad bounds (%s)', async (qs, field) => {
    const t = setup();
    const res = await get<{ error: { code: string; fields: object } }>(
      t,
      `/api/timeline?categoryId=1&${qs}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.fields).toHaveProperty(field);
  });

  it.each([
    '/api/timeline?categoryId=1',
    '/api/timeline/streams/s1',
    '/api/timeline/categories',
  ])('%s without session -> 401', async (path) => {
    const t = setup();
    const res = await t.req(path, { headers: { Cookie: '' } });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/timeline/streams/:streamId', () => {
  it('returns all segments in order', async () => {
    const t = setup();
    addStream(t, {
      id: 's1',
      by: '1',
      start: D1,
      segs: [
        { cat: JUST_CHATTING, from: D1 + H, to: D1 + 2 * H },
        { cat: ELDEN_RING, from: D1, to: D1 + H },
      ],
    });
    const { status, body } = await get<StreamDetail>(
      t,
      '/api/timeline/streams/s1',
    );
    expect(status).toBe(200);
    expect(body.segments.map((g) => g.categoryId)).toEqual([
      ELDEN_RING.id,
      JUST_CHATTING.id,
    ]);
    // Without a categories row, name comes from the segment and box art from the id.
    expect(body.segments[1]).toMatchObject({
      categoryName: 'Just Chatting',
      boxArtUrl: `https://static-cdn.jtvnw.net/ttv-boxart/${JUST_CHATTING.id}_IGDB-{width}x{height}.jpg`,
    });
  });

  it('404 for an unknown stream', async () => {
    const t = setup();
    const res = await t.req('/api/timeline/streams/nope');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/timeline/categories', () => {
  it('lists recorded categories by last played', async () => {
    const t = setup();
    addStream(t, {
      id: 's1',
      by: '1',
      start: D1,
      segs: [
        { cat: ELDEN_RING, from: D1, to: D1 + H },
        { cat: ELDEN_RING, from: D1 + 2 * H, to: D1 + 3 * H },
      ],
    });
    addStream(t, {
      id: 's2',
      by: '2',
      start: D1 + DAY,
      segs: [{ cat: MINECRAFT, from: D1 + DAY, to: null }],
    });
    const { body } = await get<RecordedCategory[]>(
      t,
      '/api/timeline/categories',
    );
    expect(body).toEqual([
      expect.objectContaining({
        id: MINECRAFT.id,
        name: 'Minecraft',
        streamCount: 1,
        lastPlayedAt: D1 + DAY,
      }),
      {
        id: ELDEN_RING.id,
        name: 'Elden Ring',
        boxArtUrl: 'https://box/er-{width}x{height}.jpg',
        streamCount: 1,
        lastPlayedAt: D1 + 2 * H,
      },
    ]);
  });
});

describe('timeline per account', () => {
  function twoAccounts() {
    const t = setup();
    // Admin follows 1 and 2 (seedStreamer); tom follows only 2.
    const tom = seedAccount(t, 'tom');
    followAs(t, tom.id, '2');
    addStream(t, {
      id: 'sa',
      by: '1',
      start: D1,
      segs: [{ cat: ELDEN_RING, from: D1, to: D1 + H }],
    });
    addStream(t, {
      id: 'sb',
      by: '2',
      start: D1 + DAY,
      segs: [{ cat: ELDEN_RING, from: D1 + DAY, to: D1 + DAY + H }],
    });
    return { t, tom };
  }

  it('lists only streams of followed broadcasters', async () => {
    const { t, tom } = twoAccounts();
    const ids = async (r: { req: AdminHarness['req'] }) =>
      ((await (await r.req('/api/timeline')).json()) as TimelinePage).items.map(
        (s) => s.streamId,
      );
    expect(await ids(t)).toEqual(['sb', 'sa']);
    expect(await ids(tom)).toEqual(['sb']);
    // A streamer filter cannot reach unfollowed broadcasters.
    const filtered = (await (
      await tom.req('/api/timeline?streamerIds=1')
    ).json()) as TimelinePage;
    expect(filtered.items).toEqual([]);
  });

  it('answers 404 for a stream of a broadcaster the caller does not follow', async () => {
    const { t, tom } = twoAccounts();
    expect((await tom.req('/api/timeline/streams/sa')).status).toBe(404);
    expect((await tom.req('/api/timeline/streams/sb')).status).toBe(200);
    expect((await t.req('/api/timeline/streams/sa')).status).toBe(200);
  });

  it('recorded categories only cover followed broadcasters', async () => {
    const { t, tom } = twoAccounts();
    addStream(t, {
      id: 'sc',
      by: '1',
      start: D1 + 2 * DAY,
      segs: [{ cat: MINECRAFT, from: D1 + 2 * DAY, to: D1 + 2 * DAY + H }],
    });
    const names = async (r: { req: AdminHarness['req'] }) =>
      (
        (await (await r.req('/api/timeline/categories')).json()) as {
          id: string;
        }[]
      ).map((c) => c.id);
    expect(await names(tom)).toEqual([ELDEN_RING.id]);
    expect((await names(t)).sort()).toEqual(
      [ELDEN_RING.id, MINECRAFT.id].sort(),
    );
  });
});
