import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { type DbHandle, openDb } from '../src/db/client.ts';
import {
  categories,
  categorySegments,
  follows,
  gameGroupCategories,
  gameGroups,
  mailOutbox,
  sentNotifications,
  sessions,
  streamerGames,
  streamerGroups,
  streamers,
  streams,
  userRecipients,
  users,
} from '../src/db/schema.ts';
import {
  ensureRecordingSince,
  getAllSettings,
  getMailLanguage,
  getMeta,
  getRecipients,
  getRecordingSince,
  getSetting,
  setMailLanguage,
  setMeta,
  setRecipients,
  setSetting,
} from '../src/db/settings.ts';
import { createTestDb } from './helpers/db.ts';
import { OWNER_ID, seedStreamer } from './helpers/seed.ts';

let handle: DbHandle | undefined;
let dir: string | undefined;

afterEach(() => {
  handle?.close();
  handle = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('openDb', () => {
  test('persists timeline_recording_since once and keeps it across restarts', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'replaymark-db-'));
    const file = path.join(dir, 'test.db');
    handle = openDb(file);
    const first = getRecordingSince(handle.db);
    expect(typeof first).toBe('number');
    handle.close();
    handle = openDb(file);
    expect(ensureRecordingSince(handle.db, (first ?? 0) + 99_999)).toBe(first);
    expect(getRecordingSince(handle.db)).toBe(first);
  });

  test('sets pragmas on a file database', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'replaymark-db-'));
    handle = openDb(path.join(dir, 'test.db'));
    const { sqlite } = handle;
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(sqlite.pragma('synchronous', { simple: true })).toBe(1);
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  test('rejects duplicate (stream_id, category_id)', () => {
    handle = createTestDb();
    const row = {
      streamId: 's1',
      categoryId: 'c1',
      broadcasterId: 'b1',
      ownerId: OWNER_ID,
      sentAt: 1,
    };
    handle.db.insert(sentNotifications).values(row).run();
    expect(() =>
      handle?.db.insert(sentNotifications).values(row).run(),
    ).toThrow(/UNIQUE/);
    handle.db
      .insert(sentNotifications)
      .values({ ...row, categoryId: 'c2' })
      .run();
  });

  test('deleting a streamer cascades to streamer_games', () => {
    handle = createTestDb();
    const { db } = handle;
    seedStreamer(db, { id: 'u1' });
    db.insert(categories).values({ categoryId: 'c1', name: 'Game' }).run();
    const own = { ownerId: OWNER_ID, userId: 'u1' };
    db.insert(streamerGames)
      .values({ ...own, categoryId: 'c1' })
      .run();
    expect(() =>
      db
        .insert(streamerGames)
        .values({ ...own, categoryId: 'x' })
        .run(),
    ).toThrow(/FOREIGN KEY/);
    db.delete(streamers).where(eq(streamers.userId, 'u1')).run();
    expect(db.select().from(streamerGames).all()).toEqual([]);
  });

  test('migrations create streams and category_segments', () => {
    handle = createTestDb();
    const tables = handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'streams',
        'category_segments',
        'category_segments_category_started_idx',
        'category_segments_stream_started_idx',
      ]),
    );
  });

  test('stream defaults and segment cascade', () => {
    handle = createTestDb();
    const { db } = handle;
    db.insert(streams)
      .values({ streamId: 's1', broadcasterId: 'b1', startedAt: 1 })
      .run();
    const [row] = db.select().from(streams).all();
    expect(row?.vodState).toBe('pending');
    expect(row?.endApprox).toBe(false);
    db.insert(categorySegments)
      .values({
        streamId: 's1',
        broadcasterId: 'b1',
        categoryId: 'c1',
        startedAt: 1,
      })
      .run();
    expect(() =>
      db
        .insert(categorySegments)
        .values({
          streamId: 'x',
          broadcasterId: 'b1',
          categoryId: 'c1',
          startedAt: 1,
        })
        .run(),
    ).toThrow(/FOREIGN KEY/);
    db.delete(streams).where(eq(streams.streamId, 's1')).run();
    expect(db.select().from(categorySegments).all()).toEqual([]);
  });
});

describe('settings', () => {
  test('defaults', () => {
    handle = createTestDb();
    expect(getAllSettings(handle.db)).toEqual({
      syncIntervalHours: 6,
      segmentRetentionDays: 365,
    });
  });

  test('roundtrip', () => {
    handle = createTestDb();
    const { db } = handle;
    setRecipients(db, 1, ['a@example.com']);
    setSetting(db, 'syncIntervalHours', 12);
    setMailLanguage(db, 1, 'en');
    setSetting(db, 'syncIntervalHours', 3);
    expect(getRecipients(db, 1)).toEqual(['a@example.com']);
    expect(getSetting(db, 'syncIntervalHours')).toBe(3);
    expect(getMailLanguage(db, 1)).toBe('en');
  });

  test('app_meta roundtrip', () => {
    handle = createTestDb();
    const { db } = handle;
    expect(getMeta(db, 'last_sync')).toBeUndefined();
    setMeta(db, 'last_sync', { at: 1, ok: true });
    setMeta(db, 'last_sync', { at: 2, ok: false });
    expect(getMeta(db, 'last_sync')).toEqual({ at: 2, ok: false });
  });
});

describe('game groups', () => {
  test('migration 0006 moves default_games into the default group', () => {
    const folder = path.resolve(import.meta.dirname, '../drizzle');
    const files = readdirSync(folder)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const run = (sqlite: Database.Database, file: string) => {
      for (const stmt of readFileSync(path.join(folder, file), 'utf8').split(
        '--> statement-breakpoint',
      ))
        sqlite.exec(stmt);
    };
    const idx = files.findIndex((f) => f.startsWith('0006_'));
    expect(idx).toBeGreaterThan(0);
    const sqlite = new Database(':memory:');
    try {
      sqlite.pragma('foreign_keys = ON');
      for (const f of files.slice(0, idx)) run(sqlite, f);
      sqlite.exec(
        "INSERT INTO categories (category_id, name) VALUES ('1','A'),('2','B'),('3','C')",
      );
      sqlite.exec("INSERT INTO default_games (category_id) VALUES ('1'),('2')");
      run(sqlite, files[idx] as string);
      const groups = sqlite.prepare('SELECT * FROM game_groups').all() as {
        name: string;
        is_default: number;
      }[];
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({ name: 'Default', is_default: 1 });
      const games = sqlite
        .prepare('SELECT category_id FROM game_group_categories ORDER BY 1')
        .all();
      expect(games).toEqual([{ category_id: '1' }, { category_id: '2' }]);
      expect(
        sqlite
          .prepare("SELECT 1 FROM sqlite_master WHERE name = 'default_games'")
          .get(),
      ).toBeUndefined();
    } finally {
      sqlite.close();
    }
  });

  test('a fresh database has exactly one default group', () => {
    handle = createTestDb();
    const rows = handle.db.select().from(gameGroups).all();
    expect(rows.map((r) => [r.name, r.isDefault])).toEqual([['Default', true]]);
  });

  test('a second default group is rejected', () => {
    handle = createTestDb();
    expect(() =>
      handle?.db
        .insert(gameGroups)
        .values({ ownerId: OWNER_ID, name: 'Other', isDefault: true })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  test('group names are unique case-insensitively', () => {
    handle = createTestDb();
    const { db } = handle;
    const own = { ownerId: OWNER_ID };
    db.insert(gameGroups)
      .values({ ...own, name: 'Souls' })
      .run();
    expect(() =>
      db
        .insert(gameGroups)
        .values({ ...own, name: 'souls' })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  test('deleting a streamer or a group cascades streamer_groups', () => {
    handle = createTestDb();
    const { db } = handle;
    for (const id of ['u1', 'u2']) seedStreamer(db, { id, mode: 'custom' });
    db.insert(categories).values({ categoryId: 'c1', name: 'C' }).run();
    const own = { ownerId: OWNER_ID };
    const g1 = db
      .insert(gameGroups)
      .values({ ...own, name: 'G1' })
      .returning()
      .get();
    const g2 = db
      .insert(gameGroups)
      .values({ ...own, name: 'G2' })
      .returning()
      .get();
    db.insert(gameGroupCategories)
      .values({ groupId: g1.id, categoryId: 'c1' })
      .run();
    db.insert(streamerGroups)
      .values([
        { ...own, userId: 'u1', groupId: g1.id },
        { ...own, userId: 'u2', groupId: g1.id },
        { ...own, userId: 'u2', groupId: g2.id },
      ])
      .run();
    db.delete(streamers).where(eq(streamers.userId, 'u1')).run();
    expect(db.select().from(streamerGroups).all()).toHaveLength(2);
    db.delete(gameGroups).where(eq(gameGroups.id, g1.id)).run();
    expect(db.select().from(streamerGroups).all()).toEqual([
      { ownerId: OWNER_ID, userId: 'u2', groupId: g2.id },
    ]);
    expect(db.select().from(gameGroupCategories).all()).toEqual([]);
  });
});

describe('accounts', () => {
  const addUser = (db: DbHandle['db'], username: string) =>
    db.insert(users).values({ username }).returning().get();

  test('a fresh database has account 1 as admin without a password', () => {
    handle = createTestDb();
    const [row] = handle.db.select().from(users).all();
    expect(row).toMatchObject({
      id: OWNER_ID,
      username: 'admin',
      role: 'admin',
      passwordHash: null,
      mailLanguage: 'de',
    });
  });

  test('usernames are unique case-insensitively', () => {
    handle = createTestDb();
    addUser(handle.db, 'Alice');
    expect(() => addUser(handle?.db as DbHandle['db'], 'alice')).toThrow(
      /UNIQUE/,
    );
    expect(() => addUser(handle?.db as DbHandle['db'], 'ADMIN')).toThrow(
      /UNIQUE/,
    );
  });

  test('group names are unique per owner, not globally', () => {
    handle = createTestDb();
    const { db } = handle;
    const other = addUser(db, 'bob');
    db.insert(gameGroups).values({ ownerId: OWNER_ID, name: 'Souls' }).run();
    db.insert(gameGroups).values({ ownerId: other.id, name: 'souls' }).run();
    expect(() =>
      db.insert(gameGroups).values({ ownerId: other.id, name: 'SOULS' }).run(),
    ).toThrow(/UNIQUE/);
  });

  test('each owner has at most one default group', () => {
    handle = createTestDb();
    const { db } = handle;
    const other = addUser(db, 'bob');
    db.insert(gameGroups)
      .values({ ownerId: other.id, name: 'Default', isDefault: true })
      .run();
    expect(() =>
      db
        .insert(gameGroups)
        .values({ ownerId: other.id, name: 'Again', isDefault: true })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  test('deleting an account cascades to everything it owns', () => {
    handle = createTestDb();
    const { db } = handle;
    const u = addUser(db, 'bob');
    seedStreamer(db, { id: 'b1', games: [{ id: 'c1', name: 'C' }] });
    db.insert(follows)
      .values({ ownerId: u.id, broadcasterId: 'b1', gameMode: 'custom' })
      .run();
    db.insert(streamerGames)
      .values({ ownerId: u.id, userId: 'b1', categoryId: 'c1' })
      .run();
    const g = db
      .insert(gameGroups)
      .values({ ownerId: u.id, name: 'G' })
      .returning()
      .get();
    db.insert(streamerGroups)
      .values({ ownerId: u.id, userId: 'b1', groupId: g.id })
      .run();
    db.insert(userRecipients).values({ userId: u.id, email: 'a@x' }).run();
    db.insert(sentNotifications)
      .values({
        streamId: 's',
        categoryId: 'c1',
        broadcasterId: 'b1',
        ownerId: u.id,
        sentAt: 1,
      })
      .run();
    db.insert(mailOutbox)
      .values({
        ownerId: u.id,
        streamId: 's',
        categoryId: 'c1',
        payload: '{}',
        nextAttemptAt: 0,
        createdAt: 0,
      })
      .run();
    db.insert(sessions)
      .values({
        id: 'tok',
        userId: u.id,
        createdAt: 0,
        expiresAt: 1,
        lastSeenAt: 0,
      })
      .run();
    db.delete(users).where(eq(users.id, u.id)).run();
    expect(db.select().from(follows).all()).toHaveLength(1);
    expect(db.select().from(streamerGames).all()).toHaveLength(1);
    expect(db.select().from(streamerGroups).all()).toEqual([]);
    for (const t of [
      gameGroups,
      userRecipients,
      sentNotifications,
      mailOutbox,
      sessions,
    ] as const) {
      const left = db.select().from(t).all() as { ownerId?: number }[];
      expect(left.filter((r) => r.ownerId === u.id)).toEqual([]);
    }
    expect(db.select().from(sessions).all()).toEqual([]);
    expect(db.select().from(userRecipients).all()).toEqual([]);
  });
});

describe('migration 0007', () => {
  const folder = path.resolve(import.meta.dirname, '../drizzle');
  const files = readdirSync(folder)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const run = (sqlite: Database.Database, file: string) => {
    for (const stmt of readFileSync(path.join(folder, file), 'utf8').split(
      '--> statement-breakpoint',
    ))
      sqlite.exec(stmt);
  };

  function seeded0006(settingsRows: [string, string][]): Database.Database {
    const idx = files.findIndex((f) => f.startsWith('0007_'));
    expect(idx).toBeGreaterThan(0);
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    for (const f of files.slice(0, idx)) run(sqlite, f);
    for (const [k, v] of settingsRows)
      sqlite
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
        .run(k, v);
    sqlite.exec(`
      INSERT INTO categories (category_id, name) VALUES ('c1','A'),('c2','B');
      INSERT INTO streamers (user_id, login, display_name, game_mode, enabled, created_at) VALUES
        ('1','alice','Alice','default',1,10),
        ('2','bob','Bob','custom',0,20),
        ('3','cara','Cara','any',1,30);
      INSERT INTO streamer_games (user_id, category_id) VALUES ('2','c1'),('2','c2');
      INSERT INTO game_groups (name, is_default, created_at) VALUES ('Souls', 0, 5);
      INSERT INTO game_group_categories (group_id, category_id)
        SELECT id, 'c1' FROM game_groups WHERE name = 'Souls';
      INSERT INTO streamer_groups (user_id, group_id)
        SELECT '2', id FROM game_groups WHERE name = 'Souls';
      INSERT INTO sent_notifications (stream_id, category_id, broadcaster_id, sent_at)
        VALUES ('s1','c1','1',100);
      INSERT INTO mail_outbox (stream_id, broadcaster_id, category_id, payload, next_attempt_at, status, created_at)
        VALUES ('s1','1','c1','{}',0,'sent',100),('s2','2','c2','{}',0,'failed',200);
      INSERT INTO sessions (id, created_at, expires_at, last_seen_at) VALUES ('tok',1,2,3);
    `);
    // The app runs migrations with foreign keys off; see openDb.
    sqlite.pragma('foreign_keys = OFF');
    run(sqlite, files[idx] as string);
    sqlite.pragma('foreign_keys = ON');
    return sqlite;
  }

  test('assigns every existing row, recipients and mail language to account 1', () => {
    const sqlite = seeded0006([
      ['recipients', JSON.stringify(['a@x', 'b@y'])],
      ['mailLanguage', JSON.stringify('en')],
      ['syncIntervalHours', '12'],
    ]);
    try {
      const all = (sql: string) => sqlite.prepare(sql).all();
      expect(all('SELECT * FROM users')).toEqual([
        expect.objectContaining({
          id: 1,
          username: 'admin',
          email: 'a@x',
          role: 'admin',
          password_hash: null,
          mail_language: 'en',
        }),
      ]);
      expect(all('SELECT email FROM user_recipients ORDER BY rowid')).toEqual([
        { email: 'a@x' },
        { email: 'b@y' },
      ]);
      expect(
        all('SELECT key FROM settings ORDER BY key').map(
          (r) => (r as { key: string }).key,
        ),
      ).toEqual(['syncIntervalHours']);
      expect(all('SELECT * FROM follows ORDER BY broadcaster_id')).toEqual([
        {
          owner_id: 1,
          broadcaster_id: '1',
          game_mode: 'default',
          enabled: 1,
          created_at: 10,
        },
        {
          owner_id: 1,
          broadcaster_id: '2',
          game_mode: 'custom',
          enabled: 0,
          created_at: 20,
        },
        {
          owner_id: 1,
          broadcaster_id: '3',
          game_mode: 'any',
          enabled: 1,
          created_at: 30,
        },
      ]);
      expect(all('SELECT login FROM streamers ORDER BY login')).toHaveLength(3);
      expect(all('SELECT * FROM streamer_games ORDER BY category_id')).toEqual([
        { owner_id: 1, user_id: '2', category_id: 'c1' },
        { owner_id: 1, user_id: '2', category_id: 'c2' },
      ]);
      expect(
        all('SELECT name, is_default, owner_id FROM game_groups ORDER BY id'),
      ).toEqual([
        { name: 'Default', is_default: 1, owner_id: 1 },
        { name: 'Souls', is_default: 0, owner_id: 1 },
      ]);
      expect(all('SELECT * FROM game_group_categories')).toHaveLength(1);
      expect(all('SELECT owner_id, user_id FROM streamer_groups')).toEqual([
        { owner_id: 1, user_id: '2' },
      ]);
      expect(all('SELECT owner_id, sent_at FROM sent_notifications')).toEqual([
        { owner_id: 1, sent_at: 100 },
      ]);
      expect(
        all('SELECT id, owner_id, status FROM mail_outbox ORDER BY id'),
      ).toEqual([
        { id: 1, owner_id: 1, status: 'sent' },
        { id: 2, owner_id: 1, status: 'failed' },
      ]);
      expect(all('SELECT id, user_id FROM sessions')).toEqual([
        { id: 'tok', user_id: 1 },
      ]);
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
      expect(
        sqlite.prepare("PRAGMA table_info('streamers')").all().length,
      ).toBe(5);
    } finally {
      sqlite.close();
    }
  });

  test('without old settings the account gets defaults', () => {
    const sqlite = seeded0006([]);
    try {
      expect(
        sqlite.prepare('SELECT email, mail_language FROM users').all(),
      ).toEqual([{ email: '', mail_language: 'de' }]);
      expect(sqlite.prepare('SELECT * FROM user_recipients').all()).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
