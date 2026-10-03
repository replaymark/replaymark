import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  categories,
  categorySegments,
  follows,
  gameGroups,
  liveState,
  mailOutbox,
  streamerGames,
  streamerGroups,
  streamers,
  streams,
  subscriptions,
  userRecipients,
  users,
} from '../src/db/schema.ts';
import { getSegmentRetentionDays, setRecipients } from '../src/db/settings.ts';
import { createBus } from '../src/events/bus.ts';
import { CONTENT_SECURITY_POLICY } from '../src/http/admin.ts';
import { createSession, hashPassword } from '../src/http/auth.ts';
import { createSseRegistry } from '../src/http/sse.ts';
import {
  createOutboxWorker,
  type OutboxWorker,
} from '../src/jobs/outbox-worker.ts';
import type { BusEvent } from '../src/shared/events.ts';
import type {
  GameGroup,
  NotificationPage,
  Overview,
  Settings,
  Streamer,
} from '../src/shared/schemas.ts';
import { SUBSCRIPTION_TYPES } from '../src/shared/schemas.ts';
import {
  type AdminHarness,
  createAdminHarness,
  followAs,
  HOST,
  seedAccount,
} from './helpers/admin.ts';
import {
  ELDEN_RING,
  JUST_CHATTING,
  OWNER_ID,
  seedCategory,
  seedDefaultGames,
  seedStreamer,
} from './helpers/seed.ts';

let h: AdminHarness | undefined;
let tmp: string | undefined;
afterEach(() => {
  h?.handle.close();
  h = undefined;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const PW = 'secret pw';
let HASH: string;
beforeAll(async () => {
  HASH = await hashPassword(PW);
});

function setup(...args: Parameters<typeof createAdminHarness>) {
  h = createAdminHarness(...args);
  return h;
}

function withPassword(t: AdminHarness) {
  t.handle.db.update(users).set({ passwordHash: HASH }).run();
}

const PROTECTED: [string, string][] = [
  ['GET', '/api/overview'],
  ['GET', '/api/streamers'],
  ['POST', '/api/streamers'],
  ['GET', '/api/streamers/lookup?login=foo'],
  ['PATCH', '/api/streamers/1'],
  ['DELETE', '/api/streamers/1'],
  ['GET', '/api/game-groups'],
  ['POST', '/api/game-groups'],
  ['PATCH', '/api/game-groups/1'],
  ['DELETE', '/api/game-groups/1'],
  ['GET', '/api/categories/search?q=elden'],
  ['GET', '/api/settings'],
  ['PUT', '/api/settings'],
  ['GET', '/api/subscriptions'],
  ['POST', '/api/sync'],
  ['GET', '/api/notifications'],
  ['POST', '/api/notifications/1/retry'],
  ['POST', '/api/notifications/retry-failed'],
  ['POST', '/api/test-mail'],
];

describe('auth', () => {
  it.each(PROTECTED)('%s %s without session -> 401', async (method, path) => {
    const t = setup();
    const res = await t.req(path, { method, headers: { Cookie: '' } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('wrong password -> 401, then rate limit 429', async () => {
    const t = setup();
    withPassword(t);
    const login = (password: string) =>
      t.req('/api/auth/login', {
        method: 'POST',
        headers: { Cookie: '' },
        json: { username: 'admin', password },
      });
    const bad = await login('nope');
    expect(bad.status).toBe(401);
    expect(bad.headers.get('Set-Cookie')).toBeNull();
    for (let i = 0; i < 4; i++) await login('nope');
    expect((await login(PW)).status).toBe(429);
  });

  it('correct password -> session cookie', async () => {
    const t = setup();
    withPassword(t);
    const res = await t.req('/api/auth/login', {
      method: 'POST',
      headers: { Cookie: '' },
      json: { username: 'admin', password: PW },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('replaymark_session=');
  });

  it.each([
    ['GET', '/api/settings'],
    ['PUT', '/api/settings'],
    ['GET', '/api/subscriptions'],
    ['POST', '/api/sync'],
  ])('%s %s as role user -> 403', async (method, path) => {
    const t = setup();
    const id = t.handle.db
      .insert(users)
      .values({ username: 'mia', role: 'user', passwordHash: HASH })
      .returning({ id: users.id })
      .get().id;
    const cookie = createSession(t.handle.db, t.clock, id);
    const res = await t.req(path, {
      method,
      headers: { Cookie: `replaymark_session=${cookie}` },
      ...(method === 'GET' ? {} : { json: {} }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden' } });
    expect(t.requested).toEqual([]);
    expect((await t.req('/api/overview')).status).toBe(200);
  });

  it('forced password change blocks the API with 403', async () => {
    const t = setup();
    t.handle.db.update(users).set({ mustChangePassword: true }).run();
    const res = await t.req('/api/overview');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: { code: 'password_change_required' },
    });
  });

  it('foreign origin -> 403', async () => {
    const t = setup();
    const res = await t.req('/api/sync', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    expect(t.requested).toEqual([]);
  });
});

describe('streamers', () => {
  it('unknown login -> 404 and nothing stored', async () => {
    const t = setup();
    const res = await t.req('/api/streamers', {
      method: 'POST',
      json: { login: 'ghost' },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: 'unknown_login' },
    });
    expect(t.handle.db.select().from(streamers).all()).toEqual([]);
    expect(t.debounced).toEqual([]);
  });

  it('lookup previews without storing', async () => {
    const t = setup();
    t.helix.users.push({
      id: '42',
      login: 'alice',
      displayName: 'Alice',
      profileImageUrl: 'https://x/a.png',
    });
    const res = await t.req('/api/streamers/lookup?login=Alice');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: '42',
      login: 'alice',
      displayName: 'Alice',
      avatarUrl: 'https://x/a.png',
      alreadyAdded: false,
    });
    expect(t.handle.db.select().from(streamers).all()).toEqual([]);
    expect((await t.req('/api/streamers/lookup?login=bob')).status).toBe(404);
  });

  it('helix failure -> 502 twitch_unavailable', async () => {
    const t = setup();
    t.helix.fail = true;
    const res = await t.req('/api/streamers', {
      method: 'POST',
      json: { login: 'alice' },
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: { code: 'twitch_unavailable' },
    });
  });

  it('add, patch with custom list, delete trigger debounced reconcile', async () => {
    const t = setup();
    t.helix.users.push({
      id: '42',
      login: 'alice',
      displayName: 'Alice',
      profileImageUrl: '',
    });
    t.helix.games.push({
      id: ELDEN_RING.id,
      name: ELDEN_RING.name,
      boxArtUrl: 'https://b/er.jpg',
    });

    const add = await t.req('/api/streamers', {
      method: 'POST',
      json: { login: 'alice' },
    });
    expect(add.status).toBe(201);
    expect(((await add.json()) as Streamer).id).toBe('42');

    const patch = await t.req('/api/streamers/42', {
      method: 'PATCH',
      json: { gameMode: 'custom', categoryIds: [ELDEN_RING.id] },
    });
    expect(patch.status).toBe(200);
    const dto = (await patch.json()) as Streamer;
    expect(dto.gameMode).toBe('custom');
    expect(dto.categories).toEqual([
      {
        id: ELDEN_RING.id,
        name: ELDEN_RING.name,
        boxArtUrl: 'https://b/er.jpg',
      },
    ]);
    const stored = t.handle.db
      .select()
      .from(categories)
      .where(eq(categories.categoryId, ELDEN_RING.id))
      .get();
    expect(stored?.boxArtUrl).toBe('https://b/er.jpg');

    const del = await t.req('/api/streamers/42', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(t.handle.db.select().from(streamers).all()).toEqual([]);
    expect(t.debounced).toHaveLength(3);
  });

  it('invalid category id -> 400 unknown_category', async () => {
    const t = setup();
    seedStreamer(t.handle.db, { id: '42' });
    const res = await t.req('/api/streamers/42', {
      method: 'PATCH',
      json: { gameMode: 'custom', categoryIds: ['999999'] },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: 'unknown_category' },
    });
    expect(t.handle.db.select().from(streamerGames).all()).toEqual([]);
    expect(t.debounced).toEqual([]);
  });

  it('PATCH groupIds sets and clears streamer groups, DTO lists them by name', async () => {
    const t = setup();
    const db = t.handle.db;
    seedStreamer(db, { id: '42', mode: 'custom' });
    const mk = async (name: string): Promise<number> => {
      const res = await t.req('/api/game-groups', {
        method: 'POST',
        json: { name, categoryIds: [] },
      });
      return ((await res.json()) as GameGroup).id;
    };
    const zeta = await mk('Zeta');
    const alpha = await mk('Alpha');

    const set = await t.req('/api/streamers/42', {
      method: 'PATCH',
      json: { groupIds: [zeta, alpha, zeta] },
    });
    expect(set.status).toBe(200);
    expect(((await set.json()) as Streamer).groups).toEqual([
      { id: alpha, name: 'Alpha' },
      { id: zeta, name: 'Zeta' },
    ]);
    expect(db.select().from(streamerGroups).all()).toHaveLength(2);

    const cleared = await t.req('/api/streamers/42', {
      method: 'PATCH',
      json: { groupIds: [] },
    });
    expect(((await cleared.json()) as Streamer).groups).toEqual([]);
    expect(db.select().from(streamerGroups).all()).toEqual([]);
  });

  it('PATCH groupIds with unknown or default group -> 400, nothing stored', async () => {
    const t = setup();
    const db = t.handle.db;
    seedStreamer(db, { id: '42', mode: 'custom' });
    const created = await t.req('/api/game-groups', {
      method: 'POST',
      json: { name: 'Souls', categoryIds: [] },
    });
    const gid = ((await created.json()) as GameGroup).id;
    await t.req('/api/streamers/42', {
      method: 'PATCH',
      json: { groupIds: [gid] },
    });
    const defaultId = db
      .select()
      .from(gameGroups)
      .where(eq(gameGroups.isDefault, true))
      .get()?.id as number;

    const unknown = await t.req('/api/streamers/42', {
      method: 'PATCH',
      json: { groupIds: [gid, 99999] },
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({
      error: { code: 'unknown_group' },
    });
    const dflt = await t.req('/api/streamers/42', {
      method: 'PATCH',
      json: { groupIds: [defaultId] },
    });
    expect(dflt.status).toBe(400);
    expect(await dflt.json()).toMatchObject({
      error: { code: 'default_group_protected' },
    });
    expect(db.select().from(streamerGroups).all()).toEqual([
      { ownerId: 1, userId: '42', groupId: gid },
    ]);
    expect(db.select().from(follows).get()?.gameMode).not.toBe('any');
  });

  it('pausing a live streamer clears its live state', async () => {
    const t = setup();
    const db = t.handle.db;
    seedStreamer(db, { id: '1', login: 'alice' });
    db.insert(liveState)
      .values({
        broadcasterId: '1',
        streamId: 's1',
        categoryId: ELDEN_RING.id,
        categoryName: ELDEN_RING.name,
        title: 't',
        startedAt: 0,
        updatedAt: 0,
      })
      .run();
    const res = await t.req('/api/streamers/1', {
      method: 'PATCH',
      json: { enabled: false },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Streamer).live).toBe(false);
    const ov = (await (await t.req('/api/overview')).json()) as Overview;
    expect(ov.streamers.live).toBe(0);
  });

  describe('closing the timeline of a live streamer', () => {
    function setupLive() {
      const bus = createBus();
      const events: BusEvent[] = [];
      bus.subscribe((e) => events.push(e));
      const t = setup({ events: { bus, registry: createSseRegistry() } });
      const db = t.handle.db;
      seedStreamer(db, { id: '1', login: 'alice' });
      const start = t.clock.now();
      db.insert(liveState)
        .values({
          broadcasterId: '1',
          streamId: 's1',
          categoryId: ELDEN_RING.id,
          categoryName: ELDEN_RING.name,
          title: 't',
          startedAt: start,
          updatedAt: 0,
        })
        .run();
      db.insert(streams)
        .values({ streamId: 's1', broadcasterId: '1', startedAt: start })
        .run();
      db.insert(categorySegments)
        .values({
          streamId: 's1',
          broadcasterId: '1',
          categoryId: ELDEN_RING.id,
          categoryName: ELDEN_RING.name,
          startedAt: start,
        })
        .run();
      t.clock.advance(60_000);
      return { t, db, events };
    }

    function expectClosed(
      db: AdminHarness['handle']['db'],
      events: BusEvent[],
      at: number,
    ) {
      const s = db
        .select()
        .from(streams)
        .where(eq(streams.streamId, 's1'))
        .get();
      expect(s).toMatchObject({ endedAt: at, endApprox: true });
      const seg = db.select().from(categorySegments).get();
      expect(seg).toMatchObject({ endedAt: at, endApprox: true });
      expect(events).toContainEqual({
        type: 'timeline',
        payload: { streamId: 's1' },
      });
    }

    it('pause while live ends stream and segment approximately', async () => {
      const { t, db, events } = setupLive();
      const res = await t.req('/api/streamers/1', {
        method: 'PATCH',
        json: { enabled: false },
      });
      expect(res.status).toBe(200);
      expectClosed(db, events, t.clock.now());
      expect(t.sent).toEqual([]);
      expect(db.select().from(mailOutbox).all()).toEqual([]);
    });

    it('delete while live ends stream and segment, keeps history', async () => {
      const { t, db, events } = setupLive();
      const res = await t.req('/api/streamers/1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      expectClosed(db, events, t.clock.now());
      expect(db.select().from(liveState).all()).toEqual([]);
      expect(t.sent).toEqual([]);
      expect(db.select().from(mailOutbox).all()).toEqual([]);
    });
  });

  it('patch unknown streamer -> 404', async () => {
    const t = setup();
    const res = await t.req('/api/streamers/1', {
      method: 'PATCH',
      json: { enabled: false },
    });
    expect(res.status).toBe(404);
  });

  it('admin subscriptions.expected counts distinct broadcasters with an enabled follow', async () => {
    const t = setup();
    const mia = seedAccount(t, 'mia');
    seedStreamer(t.handle.db, { id: '1', login: 'a' });
    seedStreamer(t.handle.db, { id: '2', login: 'b', enabled: false });
    followAs(t, mia.id, '1');
    followAs(t, mia.id, '2');
    const ov = (await (await t.req('/api/overview')).json()) as Overview;
    expect(ov.subscriptions?.expected).toBe(2 * SUBSCRIPTION_TYPES.length);
  });

  it('streamers and overview DTO shape', async () => {
    const t = setup();
    const db = t.handle.db;
    seedDefaultGames(db, [ELDEN_RING]);
    seedStreamer(db, { id: '1', login: 'alice' });
    seedStreamer(db, {
      id: '2',
      login: 'bob',
      mode: 'custom',
      games: [JUST_CHATTING],
    });
    db.insert(liveState)
      .values([
        {
          broadcasterId: '1',
          streamId: 's1',
          categoryId: ELDEN_RING.id,
          categoryName: ELDEN_RING.name,
          title: 'Boss run',
          startedAt: t.clock.now(),
          updatedAt: 0,
        },
        {
          broadcasterId: '2',
          streamId: 's2',
          categoryId: ELDEN_RING.id,
          categoryName: ELDEN_RING.name,
          title: 't',
          startedAt: 0,
          updatedAt: 0,
        },
      ])
      .run();
    db.insert(subscriptions)
      .values([
        {
          twitchSubId: 'a',
          type: 'stream.online',
          version: '1',
          broadcasterId: '1',
          status: 'enabled',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          twitchSubId: 'b',
          type: 'stream.offline',
          version: '1',
          broadcasterId: '1',
          status: 'webhook_callback_verification_pending',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          twitchSubId: 'c',
          type: 'channel.update',
          version: '2',
          broadcasterId: '1',
          status: 'notification_failures_exceeded',
          createdAt: 0,
          updatedAt: 0,
        },
      ])
      .run();

    const list = (await (await t.req('/api/streamers')).json()) as Streamer[];
    const alice = list.find((s) => s.id === '1');
    const bob = list.find((s) => s.id === '2');
    expect(alice).toMatchObject({
      login: 'alice',
      live: true,
      matches: true,
      title: 'Boss run',
      startedAt: new Date(t.clock.now()).toISOString(),
      currentCategory: { id: ELDEN_RING.id, name: ELDEN_RING.name },
      subscriptions: {
        'stream.online': 'enabled',
        'stream.offline': 'pending',
        'channel.update': 'error',
      },
      createdAt: new Date(0).toISOString(),
    });
    expect(bob).toMatchObject({
      live: true,
      matches: false,
      categories: [{ id: JUST_CHATTING.id, name: JUST_CHATTING.name }],
      subscriptions: { 'stream.online': 'missing' },
    });

    const ov = (await (await t.req('/api/overview')).json()) as Overview;
    expect(ov.streamers).toEqual({
      total: 2,
      enabled: 2,
      live: 2,
      matching: 1,
    });
    expect(ov.lastSync).toBeNull();
  });

  describe('overview notifications.lastError', () => {
    const mail = (streamId: string, status: 'failed' | 'sent', u: number) => ({
      ownerId: OWNER_ID,
      streamId,
      broadcasterId: '1',
      categoryId: ELDEN_RING.id,
      payload: '{}',
      nextAttemptAt: 0,
      createdAt: 0,
      status,
      updatedAt: u,
      lastError: `err-${streamId}`,
    });

    it('returns the error of the most recently updated failed mail', async () => {
      const t = setup();
      t.handle.db
        .insert(mailOutbox)
        .values([
          mail('new', 'failed', 200),
          mail('old', 'failed', 100),
          mail('sent', 'sent', 300),
        ])
        .run();
      const ov = (await (await t.req('/api/overview')).json()) as Overview;
      expect(ov.notifications.failed).toBe(2);
      expect(ov.notifications.lastError).toBe('err-new');
    });

    it('is null without failed mails', async () => {
      const t = setup();
      t.handle.db
        .insert(mailOutbox)
        .values([mail('sent', 'sent', 300)])
        .run();
      const ov = (await (await t.req('/api/overview')).json()) as Overview;
      expect(ov.notifications.lastError).toBeNull();
    });
  });
});

describe('settings', () => {
  const valid = { syncIntervalHours: 6 };

  it('rejects an out-of-range interval with fields', async () => {
    const t = setup();
    const res = await t.req('/api/settings', {
      method: 'PUT',
      json: { ...valid, syncIntervalHours: 0 },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; fields: Record<string, string[]> };
    };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.fields.syncIntervalHours).toBeDefined();
  });

  it('has no recipients or mail language', async () => {
    const t = setup();
    const res = await t.req('/api/settings');
    const s = (await res.json()) as Record<string, unknown>;
    expect(s).not.toHaveProperty('recipients');
    expect(s).not.toHaveProperty('mailLanguage');
  });

  it('stores settings without reconciling; ignores removed defaultCategoryIds', async () => {
    const t = setup();
    const res = await t.req('/api/settings', {
      method: 'PUT',
      json: { ...valid, defaultCategoryIds: ['1234'] },
    });
    expect(res.status).toBe(200);
    expect(t.debounced).toEqual([]);
    const s = (await res.json()) as Settings;
    expect(s).toMatchObject({
      syncIntervalHours: 6,
      callbackUrl: 'https://example.org/webhook',
    });
    expect(s).not.toHaveProperty('defaultCategories');
  });

  it('defaults segmentRetentionDays to 365', async () => {
    const t = setup();
    const res = await t.req('/api/settings');
    expect(((await res.json()) as Settings).segmentRetentionDays).toBe(365);
  });

  it('saves segmentRetentionDays; omitted keeps the stored value', async () => {
    const t = setup();
    const saved = await t.req('/api/settings', {
      method: 'PUT',
      json: { ...valid, segmentRetentionDays: 0 },
    });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as Settings).segmentRetentionDays).toBe(0);
    expect(getSegmentRetentionDays(t.handle.db)).toBe(0);
    const omitted = await t.req('/api/settings', {
      method: 'PUT',
      json: valid,
    });
    expect(((await omitted.json()) as Settings).segmentRetentionDays).toBe(0);
  });

  it('rejects segmentRetentionDays 5000 and keeps the stored value', async () => {
    const t = setup();
    const res = await t.req('/api/settings', {
      method: 'PUT',
      json: { ...valid, segmentRetentionDays: 5000 },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { fields: Record<string, string[]> };
    };
    expect(body.error.fields.segmentRetentionDays).toBeDefined();
    expect(getSegmentRetentionDays(t.handle.db)).toBe(365);
  });
});

describe('streamers live context', () => {
  function seedLive(t: AdminHarness, streamId: string) {
    t.handle.db
      .insert(liveState)
      .values({
        broadcasterId: '1',
        streamId,
        categoryId: ELDEN_RING.id,
        categoryName: ELDEN_RING.name,
        title: 't',
        startedAt: 0,
        updatedAt: 0,
      })
      .run();
  }
  function seedMail(
    t: AdminHarness,
    v: Partial<typeof mailOutbox.$inferInsert> & { streamId: string },
  ) {
    t.handle.db
      .insert(mailOutbox)
      .values({
        ownerId: OWNER_ID,
        broadcasterId: '1',
        categoryId: ELDEN_RING.id,
        payload: '{}',
        nextAttemptAt: 0,
        createdAt: 0,
        ...v,
      })
      .run();
  }
  async function alice(t: AdminHarness) {
    const list = (await (await t.req('/api/streamers')).json()) as Streamer[];
    return list.find((s) => s.id === '1') as Streamer;
  }

  it('lastLiveAt is the latest ended_at', async () => {
    const t = setup();
    seedStreamer(t.handle.db, { id: '1', login: 'alice' });
    t.handle.db
      .insert(streams)
      .values([
        { streamId: 'a', broadcasterId: '1', startedAt: 0, endedAt: 5000 },
        { streamId: 'b', broadcasterId: '1', startedAt: 0, endedAt: 9000 },
        { streamId: 'c', broadcasterId: '1', startedAt: 0, endedAt: 7000 },
      ])
      .run();
    expect((await alice(t)).lastLiveAt).toBe(new Date(9000).toISOString());
  });

  it('lastLiveAt is null without streams', async () => {
    const t = setup();
    seedStreamer(t.handle.db, { id: '1', login: 'alice' });
    const s = await alice(t);
    expect(s.lastLiveAt).toBeNull();
    expect(s.mail).toBeNull();
  });

  it('mail is the newest outbox row of the current stream (sent)', async () => {
    const t = setup();
    seedStreamer(t.handle.db, { id: '1', login: 'alice' });
    seedLive(t, 's1');
    seedMail(t, {
      streamId: 's1',
      status: 'failed',
      lastError: 'old',
      updatedAt: 1000,
    });
    seedMail(t, {
      streamId: 's1',
      status: 'sent',
      sentAt: 4000,
      updatedAt: 4500,
    });
    seedMail(t, { streamId: 'other', status: 'failed', updatedAt: 9000 });
    expect((await alice(t)).mail).toEqual({
      status: 'sent',
      at: new Date(4000).toISOString(),
      error: null,
    });
  });

  it('mail carries the error when failed', async () => {
    const t = setup();
    seedStreamer(t.handle.db, { id: '1', login: 'alice' });
    seedLive(t, 's1');
    seedMail(t, {
      streamId: 's1',
      status: 'failed',
      lastError: 'SMTP 550',
      updatedAt: 2000,
    });
    expect((await alice(t)).mail).toEqual({
      status: 'failed',
      at: new Date(2000).toISOString(),
      error: 'SMTP 550',
    });
  });

  it('mail is null when live without outbox rows', async () => {
    const t = setup();
    seedStreamer(t.handle.db, { id: '1', login: 'alice' });
    seedLive(t, 's1');
    expect((await alice(t)).mail).toBeNull();
  });

  it('mail is pending with updated_at as at', async () => {
    const t = setup();
    seedStreamer(t.handle.db, { id: '1', login: 'alice' });
    seedLive(t, 's1');
    seedMail(t, { streamId: 's1', status: 'pending', updatedAt: 3000 });
    expect((await alice(t)).mail).toEqual({
      status: 'pending',
      at: new Date(3000).toISOString(),
      error: null,
    });
  });

  it('mail is null when offline', async () => {
    const t = setup();
    seedStreamer(t.handle.db, { id: '1', login: 'alice' });
    seedMail(t, { streamId: 's1', status: 'sent', sentAt: 4000 });
    t.handle.db
      .insert(streams)
      .values({
        streamId: 's1',
        broadcasterId: '1',
        startedAt: 0,
        endedAt: 6000,
      })
      .run();
    const s = await alice(t);
    expect(s.mail).toBeNull();
    expect(s.lastLiveAt).toBe(new Date(6000).toISOString());
  });
});

describe('notifications', () => {
  function seedOutbox(t: AdminHarness) {
    const statuses = ['sent', 'failed', 'pending', 'sent', 'failed'] as const;
    statuses.forEach((status, i) => {
      t.handle.db
        .insert(mailOutbox)
        .values({
          ownerId: OWNER_ID,
          streamId: `s${i}`,
          broadcasterId: '1',
          categoryId: ELDEN_RING.id,
          payload: JSON.stringify({ gameName: 'Elden Ring', login: 'alice' }),
          status,
          nextAttemptAt: 0,
          createdAt: 1000 * i,
        })
        .run();
    });
  }

  it('paginates newest first and filters by status', async () => {
    const t = setup();
    seedOutbox(t);
    const p1 = (await (
      await t.req('/api/notifications?page=1&pageSize=2')
    ).json()) as NotificationPage;
    expect(p1.total).toBe(5);
    expect(p1.items.map((i) => i.streamId)).toEqual(['s4', 's3']);
    expect(p1.items[0]).toMatchObject({
      gameName: 'Elden Ring',
      login: 'alice',
    });
    const p3 = (await (
      await t.req('/api/notifications?page=3&pageSize=2')
    ).json()) as NotificationPage;
    expect(p3.items.map((i) => i.streamId)).toEqual(['s0']);

    const failed = (await (
      await t.req('/api/notifications?status=failed')
    ).json()) as NotificationPage;
    expect(failed.total).toBe(2);
    expect(failed.items.every((i) => i.status === 'failed')).toBe(true);

    expect((await t.req('/api/notifications?pageSize=101')).status).toBe(400);
  });

  it('counts are independent of the status filter', async () => {
    const t = setup();
    seedOutbox(t);
    const page = (await (
      await t.req('/api/notifications?status=failed')
    ).json()) as NotificationPage;
    expect(page.counts).toEqual({ all: 5, pending: 1, sent: 2, failed: 2 });
  });

  it('status accepts a comma-separated list', async () => {
    const t = setup();
    seedOutbox(t);
    const page = (await (
      await t.req('/api/notifications?status=pending,sent')
    ).json()) as NotificationPage;
    expect(page.total).toBe(3);
    expect(page.items.some((i) => i.status === 'failed')).toBe(false);
  });

  it('unknown status -> 400', async () => {
    const t = setup();
    expect((await t.req('/api/notifications?status=bogus')).status).toBe(400);
    expect((await t.req('/api/notifications?status=sent,bogus')).status).toBe(
      400,
    );
  });

  it('nextAttemptAt is set for pending and null otherwise', async () => {
    const t = setup();
    seedOutbox(t);
    const page = (await (
      await t.req('/api/notifications')
    ).json()) as NotificationPage;
    for (const i of page.items) {
      if (i.status === 'pending') {
        expect(i.nextAttemptAt).toBe(new Date(0).toISOString());
      } else expect(i.nextAttemptAt).toBeNull();
    }
  });

  it('retry-failed re-queues every failed mail and wakes the outbox', async () => {
    let woken = 0;
    let real: OutboxWorker | undefined;
    const t = setup({
      outbox: {
        retry: (id) => real?.retry(id) ?? false,
        wake: () => {
          woken++;
        },
      },
    });
    real = createOutboxWorker({
      db: t.handle.db,
      mailer: { async send() {} },
      clock: t.clock,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    seedOutbox(t);
    const res = await t.req('/api/notifications/retry-failed', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requeued: 2 });
    expect(woken).toBe(1);
    const counts = (await (
      await t.req('/api/notifications')
    ).json()) as NotificationPage;
    expect(counts.counts).toMatchObject({ failed: 0, pending: 3 });
    const again = await t.req('/api/notifications/retry-failed', {
      method: 'POST',
    });
    expect(await again.json()).toEqual({ requeued: 0 });
    const rows = t.handle.db
      .select()
      .from(mailOutbox)
      .where(inArray(mailOutbox.streamId, ['s1', 's4']))
      .all();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({
        status: 'pending',
        attempts: 0,
        nextAttemptAt: t.clock.now(),
        sentAt: null,
      });
    }
  });

  it('retry of a non-failed notification -> 404', async () => {
    const t = setup();
    seedOutbox(t);
    const res = await t.req('/api/notifications/1/retry', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(t.woken).toBe(0);
  });

  describe('admin retries another account mail', () => {
    function setupReal() {
      let real: OutboxWorker | undefined;
      const t = setup({
        outbox: { retry: (id) => real?.retry(id) ?? false, wake: () => {} },
      });
      real = createOutboxWorker({
        db: t.handle.db,
        mailer: { async send() {} },
        clock: t.clock,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      });
      const mia = seedAccount(t, 'mia');
      t.handle.db
        .insert(mailOutbox)
        .values({
          ownerId: mia.id,
          streamId: 'm1',
          broadcasterId: '1',
          categoryId: ELDEN_RING.id,
          payload: '{}',
          status: 'failed',
          nextAttemptAt: 0,
          createdAt: 0,
        })
        .run();
      return { t, mia };
    }

    it('single', async () => {
      const { t } = setupReal();
      const id = t.handle.db.select().from(mailOutbox).get()?.id;
      const res = await t.req(`/api/notifications/${id}/retry`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      expect(t.handle.db.select().from(mailOutbox).get()?.status).toBe(
        'pending',
      );
    });

    it('bulk', async () => {
      const { t } = setupReal();
      const res = await t.req('/api/notifications/retry-failed', {
        method: 'POST',
      });
      expect(await res.json()).toEqual({ requeued: 1 });
      expect(t.handle.db.select().from(mailOutbox).get()?.status).toBe(
        'pending',
      );
    });
  });

  it('retry of a failed notification wakes the outbox', async () => {
    const t = setup({
      outbox: { retry: () => true, wake: () => {} },
    });
    const res = await t.req('/api/notifications/2/retry', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});

describe('categories, sync, test mail', () => {
  it('search requires 2 chars and caches for 60 s', async () => {
    const t = setup();
    t.helix.search.push({
      id: ELDEN_RING.id,
      name: ELDEN_RING.name,
      boxArtUrl: 'u',
    });
    expect((await t.req('/api/categories/search?q=e')).status).toBe(400);
    const a = await t.req('/api/categories/search?q=Elden');
    expect(await a.json()).toEqual([
      { id: ELDEN_RING.id, name: ELDEN_RING.name, boxArtUrl: 'u' },
    ]);
    await t.req('/api/categories/search?q=elden');
    expect(
      t.helix.calls.filter((c) => c.method === 'searchCategories'),
    ).toHaveLength(1);
    expect(
      t.handle.db
        .select()
        .from(categories)
        .where(eq(categories.categoryId, ELDEN_RING.id))
        .get()?.name,
    ).toBe(ELDEN_RING.name);
    t.clock.advance(60_000);
    await t.req('/api/categories/search?q=elden');
    expect(
      t.helix.calls.filter((c) => c.method === 'searchCategories'),
    ).toHaveLength(2);
  });

  it('sync awaits the reconciler and returns last_sync', async () => {
    const t = setup();
    const res = await t.req('/api/sync', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(t.requested).toEqual(['manual']);
  });

  it('test mail: no recipients -> 400, else sent', async () => {
    const t = setup();
    expect((await t.req('/api/test-mail', { method: 'POST' })).status).toBe(
      400,
    );
    setRecipients(t.handle.db, 1, ['a@example.org']);
    const res = await t.req('/api/test-mail', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(t.sent).toHaveLength(1);
  });
});

describe('SPA and headers', () => {
  function withDist() {
    tmp = mkdtempSync(join(tmpdir(), 'ss-web-'));
    mkdirSync(join(tmp, 'assets'));
    writeFileSync(join(tmp, 'index.html'), '<!doctype html><title>ss</title>');
    writeFileSync(join(tmp, 'assets', 'app-abc123.js'), 'console.log(1)');
    return setup({ webDist: tmp });
  }

  it('deep link falls back to index.html with no-cache and CSP', async () => {
    const t = withDist();
    const res = await t.app.request(`http://${HOST}/settings`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>ss</title>');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Content-Security-Policy')).toBe(
      CONTENT_SECURITY_POLICY,
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('same-origin');
  });

  it('hashed assets get a long immutable cache', async () => {
    const t = withDist();
    const res = await t.app.request(`http://${HOST}/assets/app-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(res.headers.get('Content-Type')).toContain('javascript');
  });

  it('does not escape the dist directory', async () => {
    const t = withDist();
    const res = await t.app.request(`http://${HOST}/%2e%2e/%2e%2e/etc/passwd`);
    expect(await res.text()).not.toContain('root:');
  });

  it('unknown /api route -> 404 JSON', async () => {
    const t = withDist();
    const res = await t.req('/api/unknown');
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
    expect(res.headers.get('Content-Security-Policy')).toBe(
      CONTENT_SECURITY_POLICY,
    );
  });
});

describe('game groups', () => {
  function addGame(t: AdminHarness) {
    t.helix.games.push({
      id: ELDEN_RING.id,
      name: ELDEN_RING.name,
      boxArtUrl: 'https://b/er.jpg',
    });
  }

  it('lists the default group first with games and streamer counts', async () => {
    const t = setup();
    seedDefaultGames(t.handle.db, [JUST_CHATTING]);
    await t.req('/api/game-groups', {
      method: 'POST',
      json: { name: 'Alpha', categoryIds: [] },
    });
    const res = await t.req('/api/game-groups');
    expect(res.status).toBe(200);
    const list = (await res.json()) as GameGroup[];
    expect(list.map((g) => g.name)).toEqual(['Default', 'Alpha']);
    expect(list[0]).toMatchObject({
      isDefault: true,
      streamerCount: 0,
      games: [{ id: JUST_CHATTING.id, name: JUST_CHATTING.name }],
    });
  });

  it('creates (201), patches (200) and triggers a debounced reconcile', async () => {
    const t = setup();
    addGame(t);
    const created = await t.req('/api/game-groups', {
      method: 'POST',
      json: { name: 'Souls', categoryIds: [ELDEN_RING.id] },
    });
    expect(created.status).toBe(201);
    const dto = (await created.json()) as GameGroup;
    expect(dto).toMatchObject({
      name: 'Souls',
      isDefault: false,
      streamerCount: 0,
      games: [{ id: ELDEN_RING.id, boxArtUrl: 'https://b/er.jpg' }],
    });
    const patched = await t.req(`/api/game-groups/${dto.id}`, {
      method: 'PATCH',
      json: { name: 'Soulslike', categoryIds: [] },
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      name: 'Soulslike',
      games: [],
    });
    expect(t.debounced).toHaveLength(2);
  });

  it('publishes a groups event for every group mutation', async () => {
    const bus = createBus();
    const events: BusEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const t = setup({ events: { bus, registry: createSseRegistry() } });
    const created = await t.req('/api/game-groups', {
      method: 'POST',
      json: { name: 'Souls', categoryIds: [] },
    });
    const { id } = (await created.json()) as GameGroup;
    await t.req(`/api/game-groups/${id}`, {
      method: 'PATCH',
      json: { name: 'Soulslike' },
    });
    await t.req(`/api/game-groups/${id}`, { method: 'DELETE' });
    await t.req('/api/game-groups/999', {
      method: 'PATCH',
      json: { name: 'Nope' },
    });
    expect(events.filter((e) => e.type === 'groups')).toHaveLength(3);
  });

  it('sets Cache-Control: no-store on /api responses, errors and 404s included', async () => {
    const t = setup();
    for (const path of ['/api/overview', '/api/nope', '/api/auth/me']) {
      const res = await t.req(path);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
    const anon = await t.app.request('http://admin.local:8081/api/overview');
    expect(anon.status).toBe(401);
    expect(anon.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects admin request bodies over 64 KiB with 413', async () => {
    const t = setup();
    const res = await t.req('/api/game-groups', {
      method: 'POST',
      json: { name: 'x'.repeat(70 * 1024), categoryIds: [] },
    });
    expect(res.status).toBe(413);
  });

  it('rejects invalid input and unknown categories with 400', async () => {
    const t = setup();
    const bad = await t.req('/api/game-groups', {
      method: 'POST',
      json: { name: '  ', categoryIds: [] },
    });
    expect(bad.status).toBe(400);
    const unknown = await t.req('/api/game-groups', {
      method: 'POST',
      json: { name: 'X', categoryIds: ['999999'] },
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({
      error: { code: 'unknown_category' },
    });
    expect(t.handle.db.select().from(gameGroups).all()).toHaveLength(1);
    expect(t.debounced).toEqual([]);
  });

  it('rejects duplicate names case-insensitively with 409', async () => {
    const t = setup();
    const post = (name: string) =>
      t.req('/api/game-groups', {
        method: 'POST',
        json: { name, categoryIds: [] },
      });
    expect((await post('Souls')).status).toBe(201);
    const dup = await post('sOULS');
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({
      error: { code: 'duplicate_name' },
    });
    expect((await post('default')).status).toBe(409);
    const other = (await (await post('Other')).json()) as GameGroup;
    const ren = await t.req(`/api/game-groups/${other.id}`, {
      method: 'PATCH',
      json: { name: 'SOULS' },
    });
    expect(ren.status).toBe(409);
    const same = await t.req(`/api/game-groups/${other.id}`, {
      method: 'PATCH',
      json: { name: 'OTHER' },
    });
    expect(same.status).toBe(200);
  });

  it('protects the default group: no rename or delete (400), games editable', async () => {
    const t = setup();
    addGame(t);
    const def = (
      (await (await t.req('/api/game-groups')).json()) as GameGroup[]
    )[0] as GameGroup;
    const ren = await t.req(`/api/game-groups/${def.id}`, {
      method: 'PATCH',
      json: { name: 'Mine' },
    });
    expect(ren.status).toBe(400);
    expect(await ren.json()).toMatchObject({
      error: { code: 'default_group_protected' },
    });
    const del = await t.req(`/api/game-groups/${def.id}`, { method: 'DELETE' });
    expect(del.status).toBe(400);
    expect(await del.json()).toMatchObject({
      error: { code: 'default_group_protected' },
    });
    const games = await t.req(`/api/game-groups/${def.id}`, {
      method: 'PATCH',
      json: { categoryIds: [ELDEN_RING.id] },
    });
    expect(games.status).toBe(200);
    expect(((await games.json()) as GameGroup).games).toHaveLength(1);
  });

  it('answers 404 for unknown groups', async () => {
    const t = setup();
    for (const [method, json] of [
      ['PATCH', { name: 'x' }],
      ['DELETE', undefined],
    ] as const) {
      for (const id of ['999', 'abc']) {
        const res = await t.req(`/api/game-groups/${id}`, { method, json });
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({
          error: { code: 'not_found' },
        });
      }
    }
    expect(t.debounced).toEqual([]);
  });

  it('deleting an assigned group removes the assignments only', async () => {
    const t = setup();
    const db = t.handle.db;
    seedStreamer(db, { id: '1', mode: 'custom' });
    const dto = (await (
      await t.req('/api/game-groups', {
        method: 'POST',
        json: { name: 'Souls', categoryIds: [] },
      })
    ).json()) as GameGroup;
    db.insert(streamerGroups)
      .values({ ownerId: OWNER_ID, userId: '1', groupId: dto.id })
      .run();
    const listed = (await (
      await t.req('/api/game-groups')
    ).json()) as GameGroup[];
    expect(listed.find((g) => g.id === dto.id)?.streamerCount).toBe(1);
    const del = await t.req(`/api/game-groups/${dto.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(db.select().from(streamerGroups).all()).toEqual([]);
    expect(db.select().from(streamers).all()).toHaveLength(1);
    expect(t.debounced).toHaveLength(2);
  });

  const mkGroup = async (t: AdminHarness, name: string): Promise<number> =>
    (
      (await (
        await t.req('/api/game-groups', {
          method: 'POST',
          json: { name, categoryIds: [] },
        })
      ).json()) as GameGroup
    ).id;
  const countOf = async (t: AdminHarness, id: number): Promise<number> =>
    ((await (await t.req('/api/game-groups')).json()) as GameGroup[]).find(
      (g) => g.id === id,
    )?.streamerCount as number;

  it('default group counts default-mode streamers', async () => {
    const t = setup();
    const db = t.handle.db;
    seedStreamer(db, { id: '1', mode: 'default' });
    seedStreamer(db, { id: '2', mode: 'default' });
    seedStreamer(db, { id: '3', mode: 'any' });
    seedStreamer(db, { id: '4', mode: 'custom' });
    const list = (await (
      await t.req('/api/game-groups')
    ).json()) as GameGroup[];
    expect(list[0]).toMatchObject({ isDefault: true, streamerCount: 2 });
  });

  it('group streamerCount ignores non-custom streamers', async () => {
    const t = setup();
    const db = t.handle.db;
    const gid = await mkGroup(t, 'Souls');
    seedStreamer(db, { id: '1', mode: 'custom' });
    seedStreamer(db, { id: '2', mode: 'any' });
    seedStreamer(db, { id: '3', mode: 'default' });
    for (const id of ['1', '2', '3'])
      db.insert(streamerGroups)
        .values({ ownerId: OWNER_ID, userId: id, groupId: gid })
        .run();
    expect(await countOf(t, gid)).toBe(1);
  });

  it('PATCH to a non-custom mode clears groups, ignoring groupIds', async () => {
    const t = setup();
    const db = t.handle.db;
    const gid = await mkGroup(t, 'Souls');
    seedStreamer(db, { id: '1', mode: 'custom' });
    db.insert(streamerGroups)
      .values({ ownerId: OWNER_ID, userId: '1', groupId: gid })
      .run();
    const res = await t.req('/api/streamers/1', {
      method: 'PATCH',
      json: { gameMode: 'any', groupIds: [gid] },
    });
    expect(res.status).toBe(200);
    expect(db.select().from(streamerGroups).all()).toEqual([]);
    expect(((await res.json()) as Streamer).groups).toEqual([]);
    // Staying non-custom, a groupIds-only patch stores nothing either.
    const again = await t.req('/api/streamers/1', {
      method: 'PATCH',
      json: { groupIds: [gid] },
    });
    expect(again.status).toBe(200);
    expect(db.select().from(streamerGroups).all()).toEqual([]);
  });

  it('duplicate name with an unknown category gives 409 without a Twitch call', async () => {
    const t = setup();
    await mkGroup(t, 'Souls');
    const before = t.helix.calls.length;
    const post = await t.req('/api/game-groups', {
      method: 'POST',
      json: { name: 'souls', categoryIds: ['999999'] },
    });
    expect(post.status).toBe(409);
    const other = await mkGroup(t, 'Other');
    const patch = await t.req(`/api/game-groups/${other}`, {
      method: 'PATCH',
      json: { name: 'SOULS', categoryIds: ['999999'] },
    });
    expect(patch.status).toBe(409);
    expect(t.helix.calls.length).toBe(before);
  });

  it('rejects reserved names with duplicate_name', async () => {
    const t = setup();
    const other = await mkGroup(t, 'Other');
    for (const name of ['Default', 'default games', 'Standard-Spiele']) {
      const post = await t.req('/api/game-groups', {
        method: 'POST',
        json: { name, categoryIds: [] },
      });
      expect(post.status).toBe(409);
      expect(await post.json()).toMatchObject({
        error: { code: 'duplicate_name' },
      });
      const patch = await t.req(`/api/game-groups/${other}`, {
        method: 'PATCH',
        json: { name },
      });
      expect(patch.status).toBe(409);
    }
  });

  it('deleting an assigned group keeps the streamer single games', async () => {
    const t = setup();
    const db = t.handle.db;
    seedStreamer(db, { id: '1', mode: 'custom', games: [ELDEN_RING] });
    const gid = await mkGroup(t, 'Souls');
    db.insert(streamerGroups)
      .values({ ownerId: OWNER_ID, userId: '1', groupId: gid })
      .run();
    const del = await t.req(`/api/game-groups/${gid}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(db.select().from(streamerGames).all()).toEqual([
      { ownerId: 1, userId: '1', categoryId: ELDEN_RING.id },
    ]);
  });
});

describe('account isolation', () => {
  const addUser = (t: AdminHarness, login: string, id: string) =>
    t.helix.users.push({
      id,
      login,
      displayName: login,
      profileImageUrl: '',
    });

  async function json<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
  }

  it('streamers: each account sees and edits only its own follows', async () => {
    const t = setup();
    const tom = seedAccount(t, 'tom');
    addUser(t, 'gronkh', '7');
    const add = { method: 'POST', json: { login: 'gronkh' } };
    expect((await t.req('/api/streamers', add)).status).toBe(201);
    // Same broadcaster for a second account: new follow, shared broadcaster row.
    expect((await tom.req('/api/streamers', add)).status).toBe(201);
    expect(t.handle.db.select().from(streamers).all()).toHaveLength(1);

    await tom.req('/api/streamers/7', {
      method: 'PATCH',
      json: { gameMode: 'any', enabled: false },
    });
    const mine = await json<Streamer[]>(await t.req('/api/streamers'));
    const his = await json<Streamer[]>(await tom.req('/api/streamers'));
    expect(mine[0]).toMatchObject({ gameMode: 'default', enabled: true });
    expect(his[0]).toMatchObject({ gameMode: 'any', enabled: false });

    // Foreign follows are unknown.
    seedStreamer(t.handle.db, { id: '8', login: 'solo' });
    const solo = await tom.req('/api/streamers/8', {
      method: 'PATCH',
      json: { enabled: false },
    });
    expect(solo.status).toBe(404);
    expect(
      (await tom.req('/api/streamers/8', { method: 'DELETE' })).status,
    ).toBe(404);
    expect(
      (await json<Streamer[]>(await tom.req('/api/streamers'))).map(
        (s) => s.id,
      ),
    ).toEqual(['7']);
  });

  it('streamers: lookup reports alreadyAdded per account', async () => {
    const t = setup();
    const tom = seedAccount(t, 'tom');
    addUser(t, 'gronkh', '7');
    await t.req('/api/streamers', {
      method: 'POST',
      json: { login: 'gronkh' },
    });
    const q = '/api/streamers/lookup?login=gronkh';
    expect(
      (await json<{ alreadyAdded: boolean }>(await t.req(q))).alreadyAdded,
    ).toBe(true);
    expect(
      (await json<{ alreadyAdded: boolean }>(await tom.req(q))).alreadyAdded,
    ).toBe(false);
  });

  it('streamers: deleting the last follow deletes the broadcaster', async () => {
    const t = setup();
    const tom = seedAccount(t, 'tom');
    seedStreamer(t.handle.db, { id: '7', login: 'gronkh' });
    followAs(t, tom.id, '7');
    t.handle.db
      .insert(liveState)
      .values({ broadcasterId: '7', streamId: 's', updatedAt: 0 })
      .run();
    expect((await t.req('/api/streamers/7', { method: 'DELETE' })).status).toBe(
      200,
    );
    expect(t.handle.db.select().from(streamers).all()).toHaveLength(1);
    expect(t.handle.db.select().from(liveState).all()).toHaveLength(1);
    expect(
      (await tom.req('/api/streamers/7', { method: 'DELETE' })).status,
    ).toBe(200);
    expect(t.handle.db.select().from(streamers).all()).toEqual([]);
    expect(t.handle.db.select().from(liveState).all()).toEqual([]);
  });

  it('streamers: pausing keeps the shared live state while another account is active', async () => {
    const t = setup();
    const tom = seedAccount(t, 'tom');
    seedStreamer(t.handle.db, { id: '7', login: 'gronkh' });
    followAs(t, tom.id, '7');
    t.handle.db
      .insert(liveState)
      .values({ broadcasterId: '7', streamId: 's', updatedAt: 0 })
      .run();
    await t.req('/api/streamers/7', {
      method: 'PATCH',
      json: { enabled: false },
    });
    expect(t.handle.db.select().from(liveState).get()?.streamId).toBe('s');
  });

  it('users: deleting an account removes broadcasters nobody else follows', async () => {
    const t = setup();
    const tom = seedAccount(t, 'tom');
    seedStreamer(t.handle.db, { id: '7', login: 'shared' });
    seedStreamer(t.handle.db, { id: '8', login: 'solo' });
    followAs(t, tom.id, '7');
    // Account 1 follows both via seedStreamer; only tom keeps following 8.
    t.handle.db.delete(follows).where(eq(follows.broadcasterId, '8')).run();
    followAs(t, tom.id, '8');
    expect(
      (await t.req(`/api/users/${tom.id}`, { method: 'DELETE' })).status,
    ).toBe(200);
    expect(
      t.handle.db
        .select()
        .from(streamers)
        .all()
        .map((s) => s.userId),
    ).toEqual(['7']);
  });

  it('game groups: own only; foreign ids are unknown; counts are own', async () => {
    const t = setup();
    const tom = seedAccount(t, 'tom');
    seedCategory(t.handle.db, ELDEN_RING);
    const created = await t.req('/api/game-groups', {
      method: 'POST',
      json: { name: 'Souls', categoryIds: [ELDEN_RING.id] },
    });
    const group = await json<GameGroup>(created);
    expect(created.status).toBe(201);

    const toms = await json<GameGroup[]>(await tom.req('/api/game-groups'));
    expect(toms.map((g) => g.name)).toEqual(['Default']);
    // Same name is free for another account.
    expect(
      (
        await tom.req('/api/game-groups', {
          method: 'POST',
          json: { name: 'Souls', categoryIds: [] },
        })
      ).status,
    ).toBe(201);
    for (const [method, body] of [
      ['PATCH', { name: 'Hack' }],
      ['DELETE', undefined],
    ] as const) {
      const res = await tom.req(`/api/game-groups/${group.id}`, {
        method,
        json: body,
      });
      expect(res.status).toBe(404);
    }

    // A foreign group id on a streamer is unknown_group; nothing stored.
    seedStreamer(t.handle.db, { id: '7', login: 'gronkh', mode: 'custom' });
    followAs(t, tom.id, '7', 'custom');
    const res = await tom.req('/api/streamers/7', {
      method: 'PATCH',
      json: { groupIds: [group.id] },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: 'unknown_group' },
    });
    expect(t.handle.db.select().from(streamerGroups).all()).toEqual([]);

    // Mia's assignment does not count for Tom's group list nor vice versa.
    await t.req('/api/streamers/7', {
      method: 'PATCH',
      json: { groupIds: [group.id] },
    });
    const mine = await json<GameGroup[]>(await t.req('/api/game-groups'));
    expect(mine.find((g) => g.id === group.id)?.streamerCount).toBe(1);
    const defaults = await json<GameGroup[]>(await tom.req('/api/game-groups'));
    expect(defaults.every((g) => g.streamerCount === 0 || g.isDefault)).toBe(
      true,
    );
    expect(defaults.find((g) => g.isDefault)?.streamerCount).toBe(0);
  });

  describe('notifications', () => {
    const mail = (
      owner: number,
      streamId: string,
      status: 'failed' | 'sent',
    ) => ({
      ownerId: owner,
      streamId,
      broadcasterId: '7',
      categoryId: '1',
      payload: '{}',
      nextAttemptAt: 0,
      createdAt: 1,
      status,
    });

    it('users see their own mails, admins all with the owner username', async () => {
      const t = setup();
      const tom = seedAccount(t, 'tom');
      t.handle.db
        .insert(mailOutbox)
        .values([
          mail(OWNER_ID, 'a', 'failed'),
          mail(tom.id, 'b', 'sent'),
          mail(tom.id, 'c', 'failed'),
        ])
        .run();
      const his = await json<NotificationPage>(
        await tom.req('/api/notifications'),
      );
      expect(his.items.map((i) => i.streamId).sort()).toEqual(['b', 'c']);
      expect(his.counts).toMatchObject({ all: 2, sent: 1, failed: 1 });
      expect(his.items.every((i) => i.owner === null)).toBe(true);
      const filtered = await json<NotificationPage>(
        await tom.req('/api/notifications?status=failed'),
      );
      expect(filtered.total).toBe(1);

      const all = await json<NotificationPage>(
        await t.req('/api/notifications'),
      );
      expect(all.total).toBe(3);
      const owners = Object.fromEntries(
        all.items.map((i) => [i.streamId, i.owner]),
      );
      expect(owners).toEqual({ a: 'admin', b: 'tom', c: 'tom' });
    });

    it('retry acts only on own mails for users', async () => {
      const t = setup();
      const tom = seedAccount(t, 'tom');
      t.handle.db
        .insert(mailOutbox)
        .values([mail(OWNER_ID, 'a', 'failed'), mail(tom.id, 'b', 'failed')])
        .run();
      const first = t.handle.db.select().from(mailOutbox).all()[0];
      const res = await tom.req(`/api/notifications/${first?.id}/retry`, {
        method: 'POST',
      });
      expect(res.status).toBe(404);
      expect(t.retried).toEqual([]);
      await tom.req('/api/notifications/retry-failed', { method: 'POST' });
      expect(t.retried).toHaveLength(1);
      expect(t.retried).not.toContain(first?.id);
    });
  });

  it('overview: own counts; subscription data only for admins', async () => {
    const t = setup();
    const tom = seedAccount(t, 'tom');
    seedStreamer(t.handle.db, { id: '7', login: 'gronkh' });
    t.handle.db
      .insert(mailOutbox)
      .values({
        ownerId: OWNER_ID,
        streamId: 's',
        categoryId: '1',
        payload: '{}',
        nextAttemptAt: 0,
        createdAt: 1,
        status: 'failed',
        lastError: 'boom',
      })
      .run();
    const mine = await json<Overview>(await t.req('/api/overview'));
    expect(mine.streamers.total).toBe(1);
    expect(mine.notifications.failed).toBe(1);
    expect(mine.subscriptions).not.toBeNull();
    const his = await json<Overview>(await tom.req('/api/overview'));
    expect(his.streamers.total).toBe(0);
    expect(his.notifications).toEqual({
      pending: 0,
      failed: 0,
      lastError: null,
    });
    expect(his.recipients).toBe(1);
    expect(his.subscriptions).toBeNull();
    expect(his.lastSync).toBeNull();
  });

  it('account: GET/PATCH act on the caller; recipients and language are per account', async () => {
    const t = setup();
    const tom = seedAccount(t, 'tom');
    const patched = await tom.req('/api/account', {
      method: 'PATCH',
      json: { recipients: ['a@x.org', 'b@x.org'], mailLanguage: 'en' },
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({
      id: tom.id,
      username: 'tom',
      email: 'tom@x.org',
      recipients: ['a@x.org', 'b@x.org'],
      mailLanguage: 'en',
    });
    const mine = await json<{ recipients: string[]; mailLanguage: string }>(
      await t.req('/api/account'),
    );
    expect(mine.recipients).toEqual([]);
    expect(mine.mailLanguage).toBe('de');
    const email = await tom.req('/api/account', {
      method: 'PATCH',
      json: { email: 'new@x.org' },
    });
    expect(await email.json()).toMatchObject({
      email: 'new@x.org',
      recipients: ['a@x.org', 'b@x.org'],
    });
    for (const bad of [{}, { recipients: [] }, { recipients: ['nope'] }]) {
      const res = await tom.req('/api/account', { method: 'PATCH', json: bad });
      expect(res.status).toBe(400);
    }
  });

  it('settings no longer carry recipients; test mail goes to the caller', async () => {
    const t = setup();
    const tom = seedAccount(t, 'tom');
    setRecipients(t.handle.db, OWNER_ID, ['mia@x.org']);
    await tom.req('/api/account', {
      method: 'PATCH',
      json: { recipients: ['tom@y.org'], mailLanguage: 'en' },
    });
    expect((await tom.req('/api/test-mail', { method: 'POST' })).status).toBe(
      200,
    );
    expect(t.sent.map((m) => m.to)).toEqual([['tom@y.org']]);
    expect((await t.req('/api/test-mail', { method: 'POST' })).status).toBe(
      200,
    );
    expect(t.sent[1]?.to).toEqual(['mia@x.org']);
    expect(t.sent[1]?.subject).not.toBe(t.sent[0]?.subject);
    // A user without recipients gets no_recipients, regardless of others.
    const kim = seedAccount(t, 'kim');
    t.handle.db
      .delete(userRecipients)
      .where(eq(userRecipients.userId, kim.id))
      .run();
    const res = await kim.req('/api/test-mail', { method: 'POST' });
    expect(res.status).toBe(400);
  });
});
