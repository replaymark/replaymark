import { describe, expect, test } from 'vitest';
import {
  createHelix,
  HELIX_BASE,
  HelixError,
  parseTwitchDuration,
} from '../src/twitch/helix.ts';
import { createFakeClock } from './helpers/clock.ts';
import { createFakeFetch, json } from './helpers/fetch.ts';

function setup() {
  const clock = createFakeClock();
  const f = createFakeFetch();
  let n = 0;
  let invalidated = 0;
  const token = {
    getToken: async () => `tok${n}`,
    invalidate: () => {
      invalidated++;
      n++;
    },
  };
  const helix = createHelix({
    clientId: 'cid',
    token,
    fetch: f.fetch,
    clock,
    random: () => 0.5,
  });
  return { clock, f, helix, invalidations: () => invalidated };
}

describe('helix request', () => {
  test('sends Client-Id and bearer headers; arrays repeat the key', async () => {
    const { f, helix } = setup();
    f.on(HELIX_BASE, json({ data: [] }));
    await helix.request('GET', '/users', { query: { user_id: ['1', '2'] } });
    const req = f.requests[0];
    expect(req?.url).toBe(`${HELIX_BASE}/users?user_id=1&user_id=2`);
    expect(req?.headers['client-id']).toBe('cid');
    expect(req?.headers.authorization).toBe('Bearer tok0');
  });

  test('401 refreshes the token and retries exactly once', async () => {
    const { f, helix, invalidations } = setup();
    f.on(HELIX_BASE, json({}, 401), json({ data: [{ id: '1' }] }));
    const res = await helix.request<{ data: unknown[] }>('GET', '/users');
    expect(res.data).toHaveLength(1);
    expect(invalidations()).toBe(1);
    expect(f.requests[1]?.headers.authorization).toBe('Bearer tok1');

    const g = setup();
    g.f.on(HELIX_BASE, json({}, 401), json({}, 401), json({}, 200));
    const err = await g.helix.request('GET', '/users').catch((e) => e);
    expect(err).toBeInstanceOf(HelixError);
    expect((err as HelixError).status).toBe(401);
    expect(g.f.requests).toHaveLength(2);
  });

  test('429 waits until Ratelimit-Reset', async () => {
    const { clock, f, helix } = setup();
    const reset = Math.floor(clock.now() / 1000) + 10;
    f.on(
      HELIX_BASE,
      json({}, 429, { 'Ratelimit-Reset': String(reset) }),
      json({ data: [] }),
    );
    await helix.request('GET', '/streams');
    expect(clock.sleeps).toEqual([reset * 1000 - 1_700_000_000_000]);
    expect(f.requests).toHaveLength(2);
  });

  test('5xx is retried with backoff and gives up after 5 attempts', async () => {
    const { clock, f, helix } = setup();
    f.on(
      HELIX_BASE,
      ...Array.from({ length: 6 }, () => json({ message: 'boom' }, 503)),
    );
    const err = await helix.request('GET', '/streams').catch((e) => e);
    expect(err).toBeInstanceOf(HelixError);
    expect((err as HelixError).status).toBe(503);
    expect(String(err)).not.toContain('tok0');
    expect(f.requests).toHaveLength(5);
    expect(clock.sleeps).toEqual([500, 1000, 2000, 4000]);
  });

  test('network errors are retried', async () => {
    const { clock, f, helix } = setup();
    f.on(HELIX_BASE, new TypeError('fetch failed'), json({ data: [] }));
    await helix.request('GET', '/streams');
    expect(f.requests).toHaveLength(2);
    expect(clock.sleeps).toEqual([500]);
  });
});

describe('helix helpers', () => {
  test('getStreams with 150 ids makes 2 requests', async () => {
    const { f, helix } = setup();
    f.on(
      HELIX_BASE,
      json({ data: [{ id: 's1', user_id: '1', game_id: 'g' }] }),
      json({ data: [] }),
    );
    const ids = Array.from({ length: 150 }, (_, i) => String(i));
    const streams = await helix.getStreams(ids);
    expect(f.requests).toHaveLength(2);
    expect(
      new URL(f.requests[0]?.url ?? '').searchParams.getAll('user_id'),
    ).toHaveLength(100);
    expect(
      new URL(f.requests[1]?.url ?? '').searchParams.getAll('user_id'),
    ).toHaveLength(50);
    expect(streams[0]).toMatchObject({ id: 's1', userId: '1', gameId: 'g' });
  });

  test('listSubscriptions follows the cursor across 3 pages', async () => {
    const { f, helix } = setup();
    const sub = (id: string) => ({
      id,
      status: 'enabled',
      type: 'stream.online',
      version: '1',
      condition: { broadcaster_user_id: '1' },
      transport: { method: 'webhook', callback: 'https://x/cb' },
      created_at: 'now',
    });
    f.on(
      HELIX_BASE,
      json({ data: [sub('a')], pagination: { cursor: 'c1' } }),
      json({ data: [sub('b')], pagination: { cursor: 'c2' } }),
      json({ data: [sub('c')], pagination: {} }),
    );
    const subs = await helix.listSubscriptions();
    expect(subs.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(f.requests[1]?.url).toContain('after=c1');
    expect(f.requests[2]?.url).toContain('after=c2');
  });

  test('createSubscription posts a webhook transport', async () => {
    const { f, helix } = setup();
    f.on(HELIX_BASE, json({ data: [{ id: 'new' }] }, 202));
    const id = await helix.createSubscription({
      type: 'stream.online',
      version: '1',
      broadcasterId: '42',
      callback: 'https://x/cb',
      secret: 'sssssssssss',
    });
    expect(id).toBe('new');
    expect(JSON.parse(f.requests[0]?.body ?? '{}')).toMatchObject({
      condition: { broadcaster_user_id: '42' },
      transport: { method: 'webhook', callback: 'https://x/cb' },
    });
  });
});

describe('helix getVideos', () => {
  test('requests archives and parses duration and muted segments', async () => {
    const { f, helix } = setup();
    f.on(
      HELIX_BASE,
      json({
        data: [
          {
            id: 'v1',
            stream_id: 's1',
            user_id: 'u1',
            created_at: '2026-01-10T18:00:05Z',
            duration: '3h8m33s',
            type: 'archive',
            muted_segments: [{ duration: 30, offset: 120 }],
          },
          {
            id: 'v2',
            stream_id: 's2',
            user_id: 'u1',
            created_at: '2026-01-09T18:00:00Z',
            duration: '45s',
            type: 'archive',
            muted_segments: null,
          },
        ],
      }),
    );
    const videos = await helix.getVideos('u1', { type: 'archive', first: 100 });
    expect(f.requests[0]?.url).toBe(
      `${HELIX_BASE}/videos?user_id=u1&type=archive&first=100`,
    );
    expect(videos[0]).toEqual({
      id: 'v1',
      streamId: 's1',
      userId: 'u1',
      createdAt: '2026-01-10T18:00:05Z',
      durationSeconds: 3 * 3600 + 8 * 60 + 33,
      type: 'archive',
      mutedSegments: [{ offset: 120, duration: 30 }],
    });
    expect(videos[1]?.durationSeconds).toBe(45);
    expect(videos[1]?.mutedSegments).toEqual([]);
  });

  test('parseTwitchDuration handles partial and malformed input', () => {
    expect(parseTwitchDuration('1h2m3s')).toBe(3723);
    expect(parseTwitchDuration('12m')).toBe(720);
    expect(parseTwitchDuration('')).toBe(0);
    expect(parseTwitchDuration('abc')).toBe(0);
  });
});
