import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  follows,
  gameGroups,
  liveState,
  mailOutbox,
  sessions,
  userRecipients,
  users,
} from '../src/db/schema.ts';
import { createSession } from '../src/http/auth.ts';
import {
  type AdminHarness,
  createAdminHarness,
  followAs,
  seedAccount,
} from './helpers/admin.ts';
import { seedStreamer } from './helpers/seed.ts';

let h: AdminHarness | undefined;
afterEach(() => {
  h?.handle.close();
  h = undefined;
});

function setup() {
  h = createAdminHarness();
  return h;
}

interface UserBody {
  user: {
    id: number;
    username: string;
    email: string;
    role: string;
    createdAt: string;
    streamerCount: number;
    mustChangePassword: boolean;
  };
  temporaryPassword?: string;
}

async function create(
  t: AdminHarness,
  json: Record<string, unknown> = {},
): Promise<Response> {
  return t.req('/api/users', {
    method: 'POST',
    json: { username: 'mia', email: 'mia@x.org', role: 'user', ...json },
  });
}

function asUser(t: AdminHarness, id: number): RequestInit {
  const cookie = createSession(t.handle.db, t.clock, id);
  return { headers: { Cookie: `replaymark_session=${cookie}` } };
}

describe('user management', () => {
  it('creates a user with default group, recipient and temporary password', async () => {
    const t = setup();
    const res = await create(t, { username: 'Mia' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as UserBody;
    expect(body.temporaryPassword).toMatch(/^[A-Z2-9]{16}$/);
    expect(body.user).toMatchObject({
      username: 'mia',
      email: 'mia@x.org',
      role: 'user',
      streamerCount: 0,
      mustChangePassword: true,
    });
    const id = body.user.id;
    const groups = t.handle.db
      .select()
      .from(gameGroups)
      .where(eq(gameGroups.ownerId, id))
      .all();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ name: 'Default', isDefault: true });
    expect(
      t.handle.db
        .select()
        .from(userRecipients)
        .where(eq(userRecipients.userId, id))
        .all()
        .map((r) => r.email),
    ).toEqual(['mia@x.org']);
    expect(
      t.handle.db.select().from(users).where(eq(users.id, id)).get()
        ?.mailLanguage,
    ).toBe('de');
  });

  it('the temporary password works for login', async () => {
    const t = setup();
    const body = (await (await create(t)).json()) as UserBody;
    const res = await t.app.request('http://admin.local:8081/api/auth/login', {
      method: 'POST',
      headers: {
        Host: 'admin.local:8081',
        Origin: 'http://admin.local:8081',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'MIA',
        password: body.temporaryPassword,
      }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects invalid usernames and emails', async () => {
    const t = setup();
    for (const json of [
      { username: 'ab' },
      { username: 'a'.repeat(33) },
      { username: 'bad name' },
      { email: 'nope' },
      { role: 'root' },
    ]) {
      expect((await create(t, json)).status).toBe(400);
    }
  });

  it('rejects a duplicate username case-insensitively', async () => {
    const t = setup();
    expect((await create(t)).status).toBe(201);
    const res = await create(t, { username: 'MIA', email: 'other@x.org' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: 'username_taken' },
    });
    const admin = await create(t, { username: 'Admin' });
    expect(admin.status).toBe(409);
  });

  it('lists accounts with follow counts', async () => {
    const t = setup();
    const mia = (await (await create(t)).json()) as UserBody;
    seedStreamer(t.handle.db, { id: '1', login: 'a' });
    seedStreamer(t.handle.db, { id: '2', login: 'b' });
    t.handle.db
      .insert(follows)
      .values([
        { ownerId: mia.user.id, broadcasterId: '1' },
        { ownerId: mia.user.id, broadcasterId: '2' },
      ])
      .onConflictDoNothing()
      .run();
    const res = await t.req('/api/users');
    expect(res.status).toBe(200);
    const list = (await res.json()) as UserBody['user'][];
    expect(list.map((u) => u.username)).toEqual(['admin', 'mia']);
    expect(list[1]).toMatchObject({
      role: 'user',
      streamerCount: 2,
      mustChangePassword: true,
    });
    expect(list[0]).toHaveProperty('createdAt');
    expect(list[0]).not.toHaveProperty('passwordHash');
  });

  it('resets a password: new temporary password, flag set, sessions ended', async () => {
    const t = setup();
    const mia = (await (await create(t)).json()) as UserBody;
    createSession(t.handle.db, t.clock, mia.user.id);
    t.handle.db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.id, mia.user.id))
      .run();
    const res = await t.req(`/api/users/${mia.user.id}`, {
      method: 'PATCH',
      json: { resetPassword: true },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UserBody;
    expect(body.temporaryPassword).toMatch(/^[A-Z2-9]{16}$/);
    expect(body.temporaryPassword).not.toBe(mia.temporaryPassword);
    expect(body.user.mustChangePassword).toBe(true);
    expect(
      t.handle.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, mia.user.id))
        .all(),
    ).toEqual([]);
  });

  it('changes a role immediately', async () => {
    const t = setup();
    const mia = (await (await create(t)).json()) as UserBody;
    const init = asUser(t, mia.user.id);
    t.handle.db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.id, mia.user.id))
      .run();
    expect((await t.req('/api/users', init)).status).toBe(403);
    const res = await t.req(`/api/users/${mia.user.id}`, {
      method: 'PATCH',
      json: { role: 'admin' },
    });
    expect(((await res.json()) as UserBody).user.role).toBe('admin');
    expect((await t.req('/api/users', init)).status).toBe(200);
  });

  it('rejects an empty patch and unknown ids', async () => {
    const t = setup();
    expect(
      (await t.req('/api/users/1', { method: 'PATCH', json: {} })).status,
    ).toBe(400);
    expect(
      (
        await t.req('/api/users/99', {
          method: 'PATCH',
          json: { role: 'user' },
        })
      ).status,
    ).toBe(404);
    expect((await t.req('/api/users/99', { method: 'DELETE' })).status).toBe(
      404,
    );
  });

  it('refuses to demote the last admin, allows it with a second admin', async () => {
    const t = setup();
    const res = await t.req('/api/users/1', {
      method: 'PATCH',
      json: { role: 'user' },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'last_admin' } });
    expect(t.handle.db.select().from(users).get()?.role).toBe('admin');
    const tom = (await (
      await create(t, { username: 'tom', role: 'admin' })
    ).json()) as UserBody;
    expect(
      (
        await t.req(`/api/users/${tom.user.id}`, {
          method: 'PATCH',
          json: { role: 'user' },
        })
      ).status,
    ).toBe(200);
  });

  it('refuses to delete the own account', async () => {
    const t = setup();
    await create(t, { username: 'tom', role: 'admin' });
    const res = await t.req('/api/users/1', { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: 'cannot_delete_self' },
    });
    expect(t.handle.db.select().from(users).all()).toHaveLength(2);
  });

  it('refuses to delete the last admin', async () => {
    const t = setup();
    const mia = (await (await create(t)).json()) as UserBody;
    t.handle.db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.id, mia.user.id))
      .run();
    // a plain user cannot delete at all
    expect(
      (
        await t.req('/api/users/1', {
          method: 'DELETE',
          ...asUser(t, mia.user.id),
        })
      ).status,
    ).toBe(403);
    expect(t.handle.db.select().from(users).all()).toHaveLength(2);
  });

  it('deletes an account with its groups, recipients, follows, mails and sessions', async () => {
    const t = setup();
    const mia = (await (await create(t)).json()) as UserBody;
    const id = mia.user.id;
    seedStreamer(t.handle.db, { id: '1', login: 'a' });
    t.handle.db
      .insert(follows)
      .values({ ownerId: id, broadcasterId: '1' })
      .onConflictDoNothing()
      .run();
    createSession(t.handle.db, t.clock, id);
    const res = await t.req(`/api/users/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const db = t.handle.db;
    expect(db.select().from(users).where(eq(users.id, id)).all()).toEqual([]);
    expect(
      db.select().from(gameGroups).where(eq(gameGroups.ownerId, id)).all(),
    ).toEqual([]);
    expect(
      db
        .select()
        .from(userRecipients)
        .where(eq(userRecipients.userId, id))
        .all(),
    ).toEqual([]);
    expect(
      db.select().from(follows).where(eq(follows.ownerId, id)).all(),
    ).toEqual([]);
    expect(
      db.select().from(sessions).where(eq(sessions.userId, id)).all(),
    ).toEqual([]);
    expect(
      db.select().from(mailOutbox).where(eq(mailOutbox.ownerId, id)).all(),
    ).toEqual([]);
  });

  function seedLive(t: AdminHarness, id: string) {
    t.handle.db
      .insert(liveState)
      .values({
        broadcasterId: id,
        streamId: `s${id}`,
        categoryId: '1',
        categoryName: 'G',
        title: 't',
        startedAt: 0,
        updatedAt: 0,
      })
      .run();
  }
  const liveOf = (t: AdminHarness, id: string) =>
    t.handle.db
      .select()
      .from(liveState)
      .where(eq(liveState.broadcasterId, id))
      .get();

  it('deleting a user closes the stream when the other follower is paused', async () => {
    const t = setup();
    const mia = seedAccount(t, 'mia');
    seedStreamer(t.handle.db, { id: '1', login: 'a', enabled: false });
    followAs(t, mia.id, '1');
    seedLive(t, '1');
    const res = await t.req(`/api/users/${mia.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(liveOf(t, '1')?.streamId).toBeNull();
    expect(t.debounced).toContain('user deleted');
  });

  it('deleting a streamer follow closes the stream when the other follower is paused', async () => {
    const t = setup();
    const mia = seedAccount(t, 'mia');
    seedStreamer(t.handle.db, { id: '1', login: 'a', enabled: false });
    followAs(t, mia.id, '1');
    seedLive(t, '1');
    const res = await mia.req('/api/streamers/1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(liveOf(t, '1')?.streamId).toBeNull();
    expect(t.debounced).toContain('streamer deleted');
  });

  it('deleting a user with an enabled follow requests a reconcile even if others still follow', async () => {
    const t = setup();
    const mia = seedAccount(t, 'mia');
    seedStreamer(t.handle.db, { id: '1', login: 'a' });
    followAs(t, mia.id, '1');
    await t.req(`/api/users/${mia.id}`, { method: 'DELETE' });
    expect(t.debounced).toContain('user deleted');
    expect(liveOf(t, '1')).toBeUndefined();
  });

  it('username unique violation on insert -> 409 username_taken', async () => {
    const t = setup();
    // Simulates a concurrent insert between the pre-check and the insert.
    t.handle.sqlite.exec(
      "create trigger t_race before insert on users when new.username = 'racer' begin insert into users (username) values ('RACER'); end",
    );
    const res = await create(t, { username: 'racer' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: 'username_taken' },
    });
    expect(
      t.handle.db.select().from(users).where(eq(users.username, 'racer')).all(),
    ).toEqual([]);
  });

  it.each([
    ['GET', '/api/users'],
    ['POST', '/api/users'],
    ['PATCH', '/api/users/1'],
    ['DELETE', '/api/users/1'],
  ])('%s %s as role user -> 403', async (method, path) => {
    const t = setup();
    const mia = (await (await create(t)).json()) as UserBody;
    t.handle.db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.id, mia.user.id))
      .run();
    const res = await t.req(path, {
      method,
      ...asUser(t, mia.user.id),
      ...(method === 'GET' || method === 'DELETE' ? {} : { json: {} }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'forbidden' } });
  });
});
