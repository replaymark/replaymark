import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import { sessions, userRecipients, users } from '../src/db/schema.ts';
import {
  applyHashTakeover,
  createAccountRoutes,
  createAuthRoutes,
  createLoginRateLimiter,
  createSession,
  generateSetupCode,
  generateTemporaryPassword,
  hashPassword,
  hashSessionToken,
  ipLimiterKey,
  LIMITER_MAX_KEYS,
  needsRehash,
  originCheck,
  requireAdmin,
  requireSession,
  validateSession,
  verifyPassword,
} from '../src/http/auth.ts';
import { createFakeClock, type FakeClock } from './helpers/clock.ts';
import { createTestDb } from './helpers/db.ts';

const PW = 'correct horse';
let HASH: string;
beforeAll(async () => {
  HASH = await hashPassword(PW);
});

const DAY = 24 * 60 * 60 * 1000;
let handle: DbHandle | undefined;
afterEach(() => handle?.close());

const SETUP_CODE = 'ABCDE-FGHJK';

function setup(
  opts: {
    secure?: boolean;
    withPassword?: boolean;
    defaultLanguage?: 'en' | 'de';
    ipOf?: () => string;
    minFailureMs?: number;
  } = {},
) {
  handle = createTestDb();
  const clock = createFakeClock();
  const db = handle.db;
  if (opts.withPassword !== false) {
    db.update(users)
      .set({ username: 'admin', passwordHash: HASH })
      .where(eq(users.id, 1))
      .run();
  }
  const deps = {
    db,
    clock,
    cookieSecure: opts.secure ?? true,
    ipOf: opts.ipOf ?? (() => '1.2.3.4'),
    minFailureMs: opts.minFailureMs ?? 0,
    setupCode: () => SETUP_CODE,
    ...(opts.defaultLanguage ? { defaultLanguage: opts.defaultLanguage } : {}),
  };
  const app = new Hono();
  app.use('*', originCheck());
  app.route('/api/auth', createAuthRoutes(deps));
  app.route('/api/account', createAccountRoutes(deps));
  app.use('/api/private/*', requireSession(deps));
  app.get('/api/private/x', (c) => c.json({ ok: true }));
  app.post('/api/private/x', (c) => c.json({ ok: true }));
  app.get('/api/private/admin', requireAdmin(), (c) => c.json({ ok: true }));
  return { app, clock, db };
}

const origin = { Host: 'admin.local', Origin: 'http://admin.local' };

function post(app: Hono, path: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method: 'POST',
    headers: {
      ...origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: `replaymark_session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function login(app: Hono, password: string, username = 'admin') {
  return post(app, '/api/auth/login', { username, password });
}

function cookieOf(res: Response): string {
  const m = /replaymark_session=([^;]+)/.exec(
    res.headers.get('set-cookie') ?? '',
  );
  if (!m?.[1]) throw new Error('no cookie');
  return m[1];
}

describe('password hashing', () => {
  it('roundtrips', async () => {
    expect(HASH).toMatch(/^scrypt\$1024\$8\$1\$/);
    expect(await verifyPassword(PW, HASH)).toBe(true);
  });
  it('rejects wrong password', async () => {
    expect(await verifyPassword('nope', HASH)).toBe(false);
  });
  it('rejects malformed stored values', async () => {
    for (const s of [
      '',
      'scrypt$x',
      'bcrypt$1$2$3$4$5',
      'scrypt$3$8$1$AA==$AA==',
      'scrypt$32768$8$1$!!$??',
    ]) {
      expect(await verifyPassword(PW, s)).toBe(false);
    }
  });
});

describe('login', () => {
  it('sets a hardened cookie and stores only the hash', async () => {
    const { app, db } = setup();
    const res = await login(app, PW);
    expect(res.status).toBe(200);
    const sc = res.headers.get('set-cookie') ?? '';
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Strict');
    expect(sc).toContain('Path=/');
    expect(sc).toContain('Secure');
    expect(sc).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
    const token = cookieOf(res);
    const rows = db.select().from(sessions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(hashSessionToken(token));
    expect(rows[0]?.id).not.toBe(token);
  });

  it('omits Secure when disabled', async () => {
    const { app } = setup({ secure: false });
    const res = await login(app, PW);
    expect(res.headers.get('set-cookie')).not.toContain('Secure');
  });

  it('wrong password → 401 invalid_password', async () => {
    const { app } = setup();
    const res = await login(app, 'wrong');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      error: { code: 'invalid_password' },
    });
  });

  it('blocks after 5 failures for 15 min', async () => {
    const { app, clock } = setup();
    for (let i = 0; i < 5; i++)
      expect((await login(app, 'x')).status).toBe(401);
    const blocked = await login(app, PW);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({
      error: { code: 'rate_limited' },
    });
    clock.advance(15 * 60 * 1000);
    expect((await login(app, PW)).status).toBe(200);
  });
});

describe('sessions', () => {
  async function authed(): Promise<{
    app: Hono;
    clock: FakeClock;
    db: DbHandle['db'];
    token: string;
  }> {
    const s = setup();
    const token = cookieOf(await login(s.app, PW));
    return { ...s, token };
  }
  const get = (app: Hono, token?: string) =>
    app.request('/api/private/x', {
      headers: token ? { Cookie: `replaymark_session=${token}` } : {},
    });

  it('401 without cookie', async () => {
    const { app } = setup();
    const res = await get(app);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('ok with cookie, /me reports the account', async () => {
    const { app, token } = await authed();
    expect((await get(app, token)).status).toBe(200);
    const me = await app.request('/api/auth/me', {
      headers: { Cookie: `replaymark_session=${token}` },
    });
    expect(await me.json()).toEqual({
      id: 1,
      username: 'admin',
      role: 'admin',
      mustChangePassword: false,
    });
    expect((await app.request('/api/auth/me')).status).toBe(401);
  });

  it('expired → 401', async () => {
    const { app, clock, token } = await authed();
    clock.advance(30 * DAY + 1);
    expect((await get(app, token)).status).toBe(401);
  });

  it('slides expiry after more than one day', async () => {
    const { clock, db, token } = await authed();
    const before = db.select().from(sessions).get();
    clock.advance(DAY / 2);
    expect(validateSession(db, clock, token)).toBe(true);
    expect(db.select().from(sessions).get()?.expiresAt).toBe(before?.expiresAt);
    clock.advance(DAY);
    expect(validateSession(db, clock, token)).toBe(true);
    const after = db.select().from(sessions).get();
    expect(after?.expiresAt).toBe(clock.now() + 30 * DAY);
    expect(after?.lastSeenAt).toBe(clock.now());
    clock.advance(29 * DAY);
    expect(validateSession(db, clock, token)).toBe(true);
  });

  it('re-issues the cookie only when the session slides', async () => {
    const { app, clock, token } = await authed();
    clock.advance(DAY / 2);
    const inside = await get(app, token);
    expect(inside.status).toBe(200);
    expect(inside.headers.get('set-cookie')).toBeNull();
    clock.advance(DAY);
    const slid = await get(app, token);
    expect(slid.status).toBe(200);
    const cookie = slid.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`replaymark_session=${token}`);
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Secure');
    clock.advance(DAY / 2);
    const me = await app.request('/api/auth/me', {
      headers: { Cookie: `replaymark_session=${token}` },
    });
    expect(me.headers.get('set-cookie')).toBeNull();
    clock.advance(DAY);
    const me2 = await app.request('/api/auth/me', {
      headers: { Cookie: `replaymark_session=${token}` },
    });
    expect(me2.headers.get('set-cookie')).toContain('Max-Age=2592000');
  });

  it('createSession returns a token distinct from stored id', () => {
    const { db, clock } = setup();
    const token = createSession(db, clock, 1);
    expect(db.select().from(sessions).get()?.id).toBe(hashSessionToken(token));
  });

  it('logout deletes the session', async () => {
    const { app, db, token } = await authed();
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { ...origin, Cookie: `replaymark_session=${token}` },
    });
    expect(res.status).toBe(200);
    expect(db.select().from(sessions).all()).toHaveLength(0);
    expect((await get(app, token)).status).toBe(401);
  });
});

describe('originCheck', () => {
  it('403 on mismatch', async () => {
    const { app } = setup();
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { Host: 'admin.local', Origin: 'http://evil.example' },
      body: '{}',
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: { code: 'forbidden_origin' },
    });
  });

  it('403 when origin missing on POST', async () => {
    const { app } = setup();
    const res = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Host: 'admin.local' },
    });
    expect(res.status).toBe(403);
  });

  it('GET without origin passes', async () => {
    const { app } = setup();
    expect(
      (await app.request('/api/auth/me', { headers: { Host: 'admin.local' } }))
        .status,
    ).toBe(401);
  });
});

function addUser(
  db: DbHandle['db'],
  username: string,
  extra: Partial<typeof users.$inferInsert> = {},
): number {
  return db
    .insert(users)
    .values({
      username,
      email: `${username}@x.test`,
      passwordHash: HASH,
      role: 'user',
      ...extra,
    })
    .returning({ id: users.id })
    .get().id;
}

const cookieHeader = (token: string) => ({
  Cookie: `replaymark_session=${token}`,
});

describe('accounts and login', () => {
  it('logs in by username, case-insensitively, as that account', async () => {
    const { app, db } = setup();
    const mia = addUser(db, 'mia');
    const res = await login(app, PW, 'MIA');
    expect(res.status).toBe(200);
    expect(db.select().from(sessions).get()?.userId).toBe(mia);
  });

  it('unknown username and wrong password answer identically', async () => {
    const { app } = setup();
    const a = await login(app, 'wrong', 'admin');
    const b = await login(app, 'wrong', 'nobody');
    expect(b.status).toBe(a.status);
    expect(await b.json()).toEqual(await a.json());
    expect(b.headers.get('set-cookie')).toBeNull();
  });

  it('an account without password cannot log in', async () => {
    const { app } = setup({ withPassword: false });
    expect((await login(app, PW, 'admin')).status).toBe(401);
  });

  it('reads the role on every request', async () => {
    const { app, db } = setup();
    const mia = addUser(db, 'mia', { role: 'admin' });
    const token = cookieOf(await login(app, PW, 'mia'));
    const get = () =>
      app.request('/api/private/admin', { headers: cookieHeader(token) });
    expect((await get()).status).toBe(200);
    db.update(users).set({ role: 'user' }).where(eq(users.id, mia)).run();
    const denied = await get();
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('deleting the account ends its sessions', async () => {
    const { app, db } = setup();
    const mia = addUser(db, 'mia');
    const token = cookieOf(await login(app, PW, 'mia'));
    db.delete(users).where(eq(users.id, mia)).run();
    const res = await app.request('/api/private/x', {
      headers: cookieHeader(token),
    });
    expect(res.status).toBe(401);
  });
});

describe('password change', () => {
  const change = (
    app: Hono,
    token: string,
    currentPassword: string,
    newPassword: string,
  ) =>
    post(app, '/api/account/password', { currentPassword, newPassword }, token);

  it('ends other sessions but keeps the current one', async () => {
    const { app, db } = setup();
    addUser(db, 'mia');
    const one = cookieOf(await login(app, PW, 'mia'));
    const two = cookieOf(await login(app, PW, 'mia'));
    expect((await change(app, one, PW, 'brand new pw')).status).toBe(200);
    const get = (t: string) =>
      app.request('/api/private/x', { headers: cookieHeader(t) });
    expect((await get(one)).status).toBe(200);
    expect((await get(two)).status).toBe(401);
    expect((await login(app, 'brand new pw', 'mia')).status).toBe(200);
    expect((await login(app, PW, 'mia')).status).toBe(401);
  });

  it('wrong current password changes nothing', async () => {
    const { app, db } = setup();
    const token = cookieOf(await login(app, PW));
    const res = await change(app, token, 'nope', 'brand new pw');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: 'invalid_password' },
    });
    expect(db.select().from(users).get()?.passwordHash).toBe(HASH);
  });

  it('rate-limits wrong current passwords on the password change', async () => {
    const { app, db } = setup();
    const token = cookieOf(await login(app, PW));
    for (let i = 0; i < 5; i++)
      expect((await change(app, token, 'nope', 'brand new pw')).status).toBe(
        400,
      );
    const res = await change(app, token, PW, 'brand new pw');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: 'rate_limited' } });
    expect(db.select().from(users).get()?.passwordHash).toBe(HASH);
  });

  it('rejects the session of an account without a password hash', async () => {
    const { app, clock, db } = setup();
    const token = createSession(db, clock, 1);
    const get = () =>
      app.request('/api/private/x', { headers: cookieHeader(token) });
    expect((await get()).status).toBe(200);
    db.update(users).set({ passwordHash: null }).where(eq(users.id, 1)).run();
    expect((await get()).status).toBe(401);
  });

  it('rejects a too short new password', async () => {
    const { app } = setup();
    const token = cookieOf(await login(app, PW));
    const res = await change(app, token, PW, 'short');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: 'validation_failed' },
    });
  });

  it('requires a session', async () => {
    const { app } = setup();
    const res = await post(app, '/api/account/password', {
      currentPassword: PW,
      newPassword: 'brand new pw',
    });
    expect(res.status).toBe(401);
  });
});

describe('forced password change', () => {
  it('blocks everything but auth and the own password change until changed', async () => {
    const { app, db } = setup();
    addUser(db, 'mia', { mustChangePassword: true });
    const token = cookieOf(await login(app, PW, 'mia'));
    const blocked = await app.request('/api/private/x', {
      headers: cookieHeader(token),
    });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({
      error: { code: 'password_change_required' },
    });
    const me = await app.request('/api/auth/me', {
      headers: cookieHeader(token),
    });
    expect(await me.json()).toMatchObject({ mustChangePassword: true });
    const done = await post(
      app,
      '/api/account/password',
      { currentPassword: PW, newPassword: 'brand new pw' },
      token,
    );
    expect(done.status).toBe(200);
    const after = await app.request('/api/private/x', {
      headers: cookieHeader(token),
    });
    expect(after.status).toBe(200);
  });
});

describe('first-run setup', () => {
  const body = {
    code: SETUP_CODE,
    username: 'Mirko',
    email: 'mirko@x.test',
    password: 'a long password',
  };

  it('reports required while no account has a password', async () => {
    const { app } = setup({ withPassword: false });
    const res = await app.request('/api/auth/setup');
    expect(await res.json()).toEqual({
      required: true,
      defaultLanguage: 'en',
    });
  });

  it('reports the configured default language', async () => {
    const { app } = setup({ defaultLanguage: 'de' });
    const res = await app.request('/api/auth/setup');
    expect(await res.json()).toMatchObject({ defaultLanguage: 'de' });
  });

  it('gives the first account the default mail language', async () => {
    for (const [lang, want] of [
      [undefined, 'en'],
      ['de', 'de'],
    ] as const) {
      const { app, db } = setup({
        withPassword: false,
        defaultLanguage: lang,
      });
      await post(app, '/api/auth/setup', body);
      expect(db.select().from(users).get()?.mailLanguage).toBe(want);
      handle?.close();
    }
  });

  it('fills account 1, adds the email as recipient, starts a session', async () => {
    const { app, db } = setup({ withPassword: false });
    db.insert(userRecipients).values({ userId: 1, email: 'old@x.test' }).run();
    const res = await post(app, '/api/auth/setup', body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: true });
    const user = db.select().from(users).get();
    expect(user).toMatchObject({
      id: 1,
      username: 'mirko',
      email: 'mirko@x.test',
      role: 'admin',
      mustChangePassword: false,
    });
    expect(await verifyPassword(body.password, user?.passwordHash ?? '')).toBe(
      true,
    );
    expect(
      db
        .select()
        .from(userRecipients)
        .all()
        .map((r) => r.email)
        .sort(),
    ).toEqual(['mirko@x.test', 'old@x.test']);
    const token = cookieOf(res);
    expect(db.select().from(sessions).get()?.userId).toBe(1);
    const me = await app.request('/api/auth/me', {
      headers: cookieHeader(token),
    });
    expect(me.status).toBe(200);
    expect((await app.request('/api/auth/setup')).status).toBe(200);
    expect(await (await app.request('/api/auth/setup')).json()).toEqual({
      required: false,
      defaultLanguage: 'en',
    });
  });

  it('keeps an existing recipient list when the email is already in it', async () => {
    const { app, db } = setup({ withPassword: false });
    db.insert(userRecipients)
      .values({ userId: 1, email: 'mirko@x.test' })
      .run();
    await post(app, '/api/auth/setup', body);
    expect(db.select().from(userRecipients).all()).toHaveLength(1);
  });

  it('accepts the code case-insensitively and without the dash', async () => {
    const { app } = setup({ withPassword: false });
    const res = await post(app, '/api/auth/setup', {
      ...body,
      code: 'abcdefghjk',
    });
    expect(res.status).toBe(200);
  });

  it('wrong code -> 401, nothing changes, counts for the rate limit', async () => {
    const { app, db } = setup({ withPassword: false });
    for (let i = 0; i < 5; i++) {
      const res = await post(app, '/api/auth/setup', {
        ...body,
        code: 'WRONG',
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        error: { code: 'invalid_setup_code' },
      });
    }
    expect(db.select().from(users).get()?.passwordHash).toBeNull();
    expect((await post(app, '/api/auth/setup', body)).status).toBe(429);
    expect((await login(app, PW)).status).toBe(429);
  });

  it('two concurrent setup posts: one 200, one 409', async () => {
    const { app } = setup({ withPassword: false });
    const [a, b] = await Promise.all([
      post(app, '/api/auth/setup', body),
      post(app, '/api/auth/setup', { ...body, username: 'other' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('validates the input', async () => {
    const { app } = setup({ withPassword: false });
    for (const bad of [
      { ...body, username: 'a' },
      { ...body, username: 'bad name' },
      { ...body, email: 'nope' },
      { ...body, password: 'short' },
    ]) {
      const res = await post(app, '/api/auth/setup', bad);
      expect(res.status).toBe(400);
    }
  });

  it('is closed with 409 once an account has a password, whatever the code', async () => {
    const { app, db } = setup();
    const before = db.select().from(users).all();
    for (const code of [SETUP_CODE, 'WRONG']) {
      const res = await post(app, '/api/auth/setup', { ...body, code });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        error: { code: 'setup_completed' },
      });
    }
    expect(db.select().from(users).all()).toEqual(before);
    expect(await (await app.request('/api/auth/setup')).json()).toEqual({
      required: false,
      defaultLanguage: 'en',
    });
  });

  it('is rejected while no code exists', async () => {
    handle = createTestDb();
    const app = new Hono();
    app.route(
      '/api/auth',
      createAuthRoutes({
        db: handle.db,
        clock: createFakeClock(),
        cookieSecure: false,
        ipOf: () => '1.2.3.4',
      }),
    );
    expect((await post(app, '/api/auth/setup', body)).status).toBe(401);
  });
});

describe('generated codes', () => {
  it('uses the unambiguous alphabet and format', () => {
    expect(generateSetupCode()).toMatch(
      /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/,
    );
    expect(generateTemporaryPassword()).toMatch(/^[A-HJKMNP-Z2-9]{16}$/);
  });
});

describe('hash takeover', () => {
  const logger = { info: () => {} };

  it('adopts the hash for account 1 while nobody has a password', async () => {
    const { app, db } = setup({ withPassword: false });
    expect(applyHashTakeover(db, HASH, logger)).toBe(true);
    expect(await (await app.request('/api/auth/setup')).json()).toEqual({
      required: false,
      defaultLanguage: 'en',
    });
    expect((await login(app, PW, 'admin')).status).toBe(200);
  });

  it('keeps data of account 1 and logs the removal hint', () => {
    const { db } = setup({ withPassword: false });
    db.insert(userRecipients).values({ userId: 1, email: 'a@x' }).run();
    const logs: string[] = [];
    applyHashTakeover(db, HASH, { info: (m) => logs.push(m) });
    expect(db.select().from(userRecipients).all()).toHaveLength(1);
    expect(logs.join()).toContain('can be removed');
  });

  it('has no effect once an account has a password', async () => {
    const { db } = setup();
    const other = await hashPassword('other password');
    const logs: string[] = [];
    expect(applyHashTakeover(db, other, { info: (m) => logs.push(m) })).toBe(
      false,
    );
    expect(db.select().from(users).get()?.passwordHash).toBe(HASH);
    expect(logs.join()).toContain('can be removed');
  });

  it('does nothing without a hash or with a malformed one', () => {
    const { db } = setup({ withPassword: false });
    expect(applyHashTakeover(db, undefined, logger)).toBe(false);
    expect(applyHashTakeover(db, 'garbage', logger)).toBe(false);
    expect(db.select().from(users).get()?.passwordHash).toBeNull();
  });
});

describe('hardening', () => {
  it('ends a session 90 days after login however active it was', async () => {
    const { app, clock, db } = setup();
    const token = cookieOf(await login(app, PW));
    for (let day = 0; day < 89; day++) {
      clock.advance(DAY);
      expect(validateSession(db, clock, token)).toBe(true);
    }
    const row = db.select().from(sessions).get();
    expect(row?.expiresAt).toBeLessThanOrEqual(
      (row?.createdAt ?? 0) + 90 * DAY,
    );
    clock.advance(2 * DAY);
    expect(validateSession(db, clock, token)).toBe(false);
  });

  it('blocks a username after 10 failures from different IPs', () => {
    const clock = createFakeClock();
    const limiter = createLoginRateLimiter(clock);
    for (let i = 0; i < 10; i++) limiter.recordFailure(`10.0.0.${i}`, 'Admin');
    expect(limiter.isBlocked('10.0.0.99', 'admin')).toBe(true);
    expect(limiter.isBlocked('10.0.0.99', 'other')).toBe(false);
    clock.advance(15 * 60 * 1000);
    expect(limiter.isBlocked('10.0.0.99', 'admin')).toBe(false);
  });

  it('answers 429 on login once the username failed 10 times from 10 IPs', async () => {
    let n = 0;
    const { app } = setup({ ipOf: () => `9.9.9.${n}` });
    for (n = 0; n < 10; n++)
      expect((await login(app, 'wrong')).status).toBe(401);
    n = 99;
    const res = await login(app, PW);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      error: { code: 'rate_limited' },
    });
  });

  it('at capacity keeps live keys and blocks unknown new ones', () => {
    const clock = createFakeClock();
    const limiter = createLoginRateLimiter(clock);
    for (let i = 0; i < LIMITER_MAX_KEYS + 50; i++)
      limiter.recordFailure(`ip${i}`, `user${i}`);
    // ip0 is live and was not evicted; a brand-new key is refused.
    limiter.recordFailure('ip0');
    expect(limiter.isBlocked('ip0')).toBe(false);
    expect(limiter.isBlocked('fresh-ip')).toBe(true);
    // Once the window passed, expired keys are swept and new keys fit again.
    clock.advance(16 * 60 * 1000);
    expect(limiter.isBlocked('fresh-ip')).toBe(false);
  });

  it('keys IPv6 by /64 and IPv4-mapped IPv6 as IPv4', () => {
    expect(ipLimiterKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(
      ipLimiterKey('2001:db8:1:2::1'),
    );
    expect(ipLimiterKey('2001:db8:1:2::1')).not.toBe(
      ipLimiterKey('2001:db8:1:3::1'),
    );
    expect(ipLimiterKey('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(ipLimiterKey('::ffff:102:304')).toBe('1.2.3.4');
    expect(ipLimiterKey('1.2.3.4')).toBe('1.2.3.4');
    const limiter = createLoginRateLimiter(createFakeClock());
    for (let i = 0; i < 5; i++)
      limiter.recordFailure(`2001:db8:1:2:${i}::1`, `u${i}`);
    expect(limiter.isBlocked('2001:db8:1:2:ffff::9')).toBe(true);
  });

  it('rejects usernames over 64 characters on login with 400', async () => {
    const { app } = setup();
    expect((await login(app, PW, 'x'.repeat(65))).status).toBe(400);
  });

  it('pads failed logins to the minimum duration, unknown user or wrong password', async () => {
    const { app } = setup({ minFailureMs: 150 });
    for (const username of ['admin', 'nobody']) {
      const t0 = performance.now();
      expect((await login(app, 'wrong', username)).status).toBe(401);
      expect(performance.now() - t0).toBeGreaterThanOrEqual(140);
    }
  });

  it('does not overwrite a hash changed during the rehash', async () => {
    const { app, db } = setup();
    const old = await hashPassword(PW, 2 ** 9);
    db.update(users).set({ passwordHash: old }).where(eq(users.id, 1)).run();
    const pending = login(app, PW);
    // Same tick as the handler's first await: swap the stored hash underneath it.
    db.update(users)
      .set({ passwordHash: 'changed-meanwhile' })
      .where(eq(users.id, 1))
      .run();
    await pending;
    expect(db.select().from(users).get()?.passwordHash).not.toBe(old);
    expect(db.select().from(users).get()?.passwordHash).toBe(
      'changed-meanwhile',
    );
  });

  it('rejects passwords over 200 characters with 400', async () => {
    const { app } = setup();
    const res = await login(app, 'x'.repeat(201));
    expect(res.status).toBe(400);
    const setupRes = await post(app, '/api/auth/setup', {
      code: SETUP_CODE,
      username: 'abc',
      email: 'a@b.org',
      password: 'x'.repeat(201),
    });
    expect([400, 409]).toContain(setupRes.status);
  });

  it('rehashes a lower-cost hash on successful login and still verifies old hashes', async () => {
    const { app, db } = setup();
    const old = await hashPassword(PW, 2 ** 9);
    expect(needsRehash(old)).toBe(true);
    db.update(users).set({ passwordHash: old }).where(eq(users.id, 1)).run();
    expect((await login(app, PW)).status).toBe(200);
    const stored = db.select().from(users).get()?.passwordHash ?? '';
    expect(stored).not.toBe(old);
    expect(needsRehash(stored)).toBe(false);
    expect(await verifyPassword(PW, stored)).toBe(true);
    expect(await verifyPassword(PW, old)).toBe(true);
  });

  it('does not rehash after a failed login', async () => {
    const { app, db } = setup();
    const old = await hashPassword(PW, 2 ** 9);
    db.update(users).set({ passwordHash: old }).where(eq(users.id, 1)).run();
    expect((await login(app, 'wrong')).status).toBe(401);
    expect(db.select().from(users).get()?.passwordHash).toBe(old);
  });
});
