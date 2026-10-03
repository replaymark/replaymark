import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import {
  follows,
  gameGroupCategories,
  gameGroups,
  sessions,
  streamerGames,
  streamerGroups,
  streamers,
  subscriptions,
  users,
} from '../src/db/schema.ts';
import { setMeta } from '../src/db/settings.ts';
import { verifyPassword } from '../src/http/auth.ts';
import { createInternalApp } from '../src/http/internal.ts';
import type { TwitchCategory, TwitchUser } from '../src/twitch/helix.ts';
import { createFakeClock } from './helpers/clock.ts';
import { createTestDb } from './helpers/db.ts';
import {
  ELDEN_RING,
  OWNER_ID,
  seedStreamer,
  seedUser,
} from './helpers/seed.ts';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

function setup() {
  const handle = createTestDb();
  const clock = createFakeClock();
  const users: TwitchUser[] = [
    { id: '1', login: 'alice', displayName: 'Alice', profileImageUrl: '' },
    { id: '2', login: 'bob', displayName: 'Bob', profileImageUrl: '' },
  ];
  const games: TwitchCategory[] = [
    { id: ELDEN_RING.id, name: ELDEN_RING.name, boxArtUrl: 'e.jpg' },
    { id: '27471', name: 'Minecraft', boxArtUrl: 'm.jpg' },
  ];
  const requested: string[] = [];
  const helix = {
    async getUsersByLogin(logins: readonly string[]) {
      return users.filter((u) => logins.includes(u.login));
    },
    // Twitch matches names exactly; case-insensitivity must come from our side.
    async getGames(input: {
      ids?: readonly string[];
      names?: readonly string[];
    }) {
      return games.filter((g) => input.names?.includes(g.name));
    },
    async searchCategories(q: string) {
      return games.filter((g) =>
        g.name.toLowerCase().includes(q.toLowerCase()),
      );
    },
  };
  const app = createInternalApp({
    db: handle.db,
    clock,
    logger: silent,
    helix,
    reconciler: {
      async request(reason) {
        requested.push(reason);
      },
    },
    mailer: { async send() {} },
  });
  return { handle, app, requested };
}

let handle: DbHandle | undefined;
afterEach(() => {
  try {
    handle?.close();
  } catch {
    // already closed
  }
  handle = undefined;
});

describe('GET /healthz', () => {
  it('returns 200 with status fields', async () => {
    const s = setup();
    handle = s.handle;
    s.handle.db
      .insert(subscriptions)
      .values({
        twitchSubId: 's1',
        type: 'stream.online',
        version: '1',
        broadcasterId: '1',
        status: 'enabled',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    setMeta(s.handle.db, 'last_sync', {
      at: Date.UTC(2026, 0, 1),
      ok: true,
      active: 1,
      created: 0,
      deleted: 0,
      errors: [],
    });
    const res = await s.app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      subscriptionsEnabled: 1,
      lastSyncAt: '2026-01-01T00:00:00.000Z',
      lastSyncOk: true,
    });
  });

  it('returns nulls before the first sync', async () => {
    const s = setup();
    handle = s.handle;
    expect(await (await s.app.request('/healthz')).json()).toEqual({
      status: 'ok',
      subscriptionsEnabled: 0,
      lastSyncAt: null,
      lastSyncOk: null,
    });
  });

  it('returns 503 when the database is closed', async () => {
    const s = setup();
    s.handle.close();
    const res = await s.app.request('/healthz');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'error' });
  });
});

describe('GET /internal/status', () => {
  it('lists streamers with live and subscription state', async () => {
    const s = setup();
    handle = s.handle;
    seedStreamer(s.handle.db, {
      id: '1',
      login: 'alice',
      displayName: 'Alice',
    });
    const res = await s.app.request('/internal/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        id: '1',
        login: 'alice',
        displayName: 'Alice',
        enabled: true,
        live: false,
        currentGame: null,
        subscriptions: {
          'stream.online': 'missing',
          'stream.offline': 'missing',
          'channel.update': 'missing',
        },
      },
    ]);
  });
});

describe('POST /internal/import', () => {
  it('resolves logins and games case-insensitively, reports unknowns, reconciles', async () => {
    const s = setup();
    handle = s.handle;
    const res = await s.app.request('/internal/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defaultGames: ['elden ring', 'Nope Game'],
        streamers: [
          { login: 'ALICE', games: null },
          { login: 'bob', games: ['MINECRAFT', 'Nope Game'] },
          { login: 'ghost', games: '*' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      imported: ['alice', 'bob'],
      unknownLogins: ['ghost'],
      unknownGames: ['Nope Game'],
    });
    const db = s.handle.db;
    expect(
      db
        .select({ categoryId: gameGroupCategories.categoryId })
        .from(gameGroupCategories)
        .all(),
    ).toEqual([{ categoryId: ELDEN_RING.id }]);
    const rows = db.select().from(streamers).orderBy(streamers.login).all();
    const modes = new Map(
      s.handle.db
        .select()
        .from(follows)
        .all()
        .map((f) => [f.broadcasterId, f.gameMode]),
    );
    expect(rows.map((r) => [r.login, modes.get(r.userId)])).toEqual([
      ['alice', 'default'],
      ['bob', 'custom'],
    ]);
    expect(
      db
        .select()
        .from(streamerGames)
        .where(eq(streamerGames.userId, '2'))
        .all(),
    ).toEqual([{ ownerId: 1, userId: '2', categoryId: '27471' }]);
    expect(s.requested).toEqual(['import']);
  });

  it('import clears existing group assignments', async () => {
    const s = setup();
    handle = s.handle;
    const db = s.handle.db;
    seedStreamer(db, { id: '1', login: 'alice', mode: 'custom' });
    const gid = db
      .insert(gameGroups)
      .values({ ownerId: OWNER_ID, name: 'Souls' })
      .returning({ id: gameGroups.id })
      .get().id;
    db.insert(streamerGroups)
      .values({ ownerId: OWNER_ID, userId: '1', groupId: gid })
      .run();
    const res = await s.app.request('/internal/import', {
      method: 'POST',
      body: JSON.stringify({ streamers: [{ login: 'alice', games: null }] }),
    });
    expect(res.status).toBe(200);
    expect(db.select().from(streamerGroups).all()).toEqual([]);
  });

  it('maps * to any and rejects invalid bodies', async () => {
    const s = setup();
    handle = s.handle;
    const ok = await s.app.request('/internal/import', {
      method: 'POST',
      body: JSON.stringify({ streamers: [{ login: 'alice', games: '*' }] }),
    });
    expect(ok.status).toBe(200);
    expect(s.handle.db.select().from(follows).get()?.gameMode).toBe('any');
    const bad = await s.app.request('/internal/import', {
      method: 'POST',
      body: JSON.stringify({ streamers: [{ login: 'x', games: 5 }] }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('POST /internal/users/reset-password', () => {
  const post = (s: ReturnType<typeof setup>, username: string) =>
    s.app.request('/internal/users/reset-password', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });

  it('sets a temporary password, ends sessions and sets the flag', async () => {
    const s = setup();
    handle = s.handle;
    const db = s.handle.db;
    const mia = seedUser(db, 'Mia');
    db.insert(sessions)
      .values({
        id: 'tok',
        userId: mia,
        createdAt: 1,
        expiresAt: 2,
        lastSeenAt: 1,
      })
      .run();
    const res = await post(s, 'mia');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      username: string;
      temporaryPassword: string;
    };
    expect(body.username).toBe('Mia');
    const row = db.select().from(users).where(eq(users.id, mia)).get();
    expect(row?.mustChangePassword).toBe(true);
    expect(
      verifyPassword(body.temporaryPassword, row?.passwordHash ?? ''),
    ).toBe(true);
    expect(db.select().from(sessions).all()).toEqual([]);
  });

  it('answers 404 for an unknown account and changes nothing', async () => {
    const s = setup();
    handle = s.handle;
    const before = s.handle.db.select().from(users).all();
    expect((await post(s, 'nobody')).status).toBe(404);
    expect(s.handle.db.select().from(users).all()).toEqual(before);
  });

  it('rejects a missing username', async () => {
    const s = setup();
    handle = s.handle;
    const res = await s.app.request('/internal/users/reset-password', {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(400);
  });
});
