import {
  createHash,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { and, asc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import {
  sessions,
  type UserRole,
  userRecipients,
  users,
} from '../db/schema.ts';
import {
  getMailLanguage,
  getRecipients,
  setMailLanguage,
  setRecipients,
} from '../db/settings.ts';
import { ADMIN_PASSWORD_HASH_RE } from '../env.ts';
import type { Logger } from '../log.ts';
import { apiError } from '../shared/errors.ts';
import {
  type Account,
  changePasswordInput,
  loginInput,
  patchAccountInput,
  setupInput,
} from '../shared/schemas.ts';

/** The account a request runs as; resolved from the session on every request. */
export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
  mustChangePassword: boolean;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
    sessionId: string;
  }
}

// ---------- password hashing ----------

const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 32;
const KEY_BYTES = 64;

function maxmemFor(n: number, r: number, p: number): number {
  return 128 * n * r * p + 128 * r * (p + 2) + 1024 * 1024;
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(pw, salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: maxmemFor(SCRYPT_N, SCRYPT_R, SCRYPT_P),
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function verifyPassword(pw: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nS, rS, pS, saltS, hashS] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (!/^\d+$/.test(nS) || !/^\d+$/.test(rS) || !/^\d+$/.test(pS)) {
    return false;
  }
  const n = Number(nS);
  const r = Number(rS);
  const p = Number(pS);
  // N must be a power of two > 1; bound parameters to avoid resource abuse.
  if (n < 2 || n > 2 ** 20 || (n & (n - 1)) !== 0) return false;
  if (r < 1 || r > 32 || p < 1 || p > 16) return false;
  if (!B64.test(saltS) || !B64.test(hashS)) return false;
  const salt = Buffer.from(saltS, 'base64');
  const expected = Buffer.from(hashS, 'base64');
  if (salt.length === 0 || expected.length < 16) return false;
  try {
    const actual = scryptSync(pw, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: maxmemFor(n, r, p),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------- sessions ----------

export const SESSION_COOKIE = 'replaymark_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SLIDE_AFTER_MS = 24 * 60 * 60 * 1000;

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Creates a session; returns the raw cookie value (only its hash is stored). */
export function createSession(db: Db, clock: Clock, userId: number): string {
  const token = randomBytes(32).toString('base64url');
  const now = clock.now();
  db.insert(sessions)
    .values({
      id: hashSessionToken(token),
      userId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      lastSeenAt: now,
    })
    .run();
  return token;
}

/** Validates a cookie value; extends the session when the last extension is older than 1 day. */
export function validateSession(
  db: Db,
  clock: Clock,
  cookieValue: string | undefined,
): boolean {
  return checkSession(db, clock, cookieValue).state !== 'invalid';
}

export interface SessionCheck {
  state: 'invalid' | 'valid' | 'extended';
  user?: AuthUser;
}

/** Like validateSession, but also resolves the account and reports whether the session slid. */
export function checkSession(
  db: Db,
  clock: Clock,
  cookieValue: string | undefined,
): SessionCheck {
  if (!cookieValue) return { state: 'invalid' };
  const id = hashSessionToken(cookieValue);
  const row = db
    .select({
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      id: users.id,
      username: users.username,
      role: users.role,
      mustChangePassword: users.mustChangePassword,
      passwordHash: users.passwordHash,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  if (!row?.passwordHash) return { state: 'invalid' };
  const now = clock.now();
  if (row.expiresAt <= now) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return { state: 'invalid' };
  }
  const user: AuthUser = {
    id: row.id,
    username: row.username,
    role: row.role,
    mustChangePassword: row.mustChangePassword,
  };
  if (now - row.lastSeenAt > SLIDE_AFTER_MS) {
    db.update(sessions)
      .set({ expiresAt: now + SESSION_TTL_MS, lastSeenAt: now })
      .where(eq(sessions.id, id))
      .run();
    return { state: 'extended', user };
  }
  return { state: 'valid', user };
}

function setSessionCookie(c: Context, token: string, secure: boolean): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
    secure,
  });
}

/** Validates the session cookie, stores the account in the context; re-issues the cookie when the session slid. */
function authenticate(
  c: Context,
  deps: Pick<AuthDeps, 'db' | 'clock' | 'cookieSecure'>,
): AuthUser | undefined {
  const token = getCookie(c, SESSION_COOKIE);
  const { state, user } = checkSession(deps.db, deps.clock, token);
  if (state === 'invalid' || !user || !token) return undefined;
  if (state === 'extended') setSessionCookie(c, token, deps.cookieSecure);
  c.set('user', user);
  c.set('sessionId', hashSessionToken(token));
  return user;
}

export function deleteSession(db: Db, cookieValue: string | undefined): void {
  if (!cookieValue) return;
  db.delete(sessions)
    .where(eq(sessions.id, hashSessionToken(cookieValue)))
    .run();
}

// ---------- login rate limit ----------

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 5;

export interface LoginRateLimiter {
  isBlocked(ip: string): boolean;
  recordFailure(ip: string): void;
}

/** In-memory: at most 5 failures per IP inside a sliding 15 min window. */
export function createLoginRateLimiter(clock: Clock): LoginRateLimiter {
  const failures = new Map<string, number[]>();
  const prune = (now: number) => {
    for (const [ip, times] of failures) {
      const recent = times.filter((t) => now - t < LOGIN_WINDOW_MS);
      if (recent.length === 0) failures.delete(ip);
      else failures.set(ip, recent);
    }
  };
  return {
    isBlocked(ip) {
      prune(clock.now());
      return (failures.get(ip)?.length ?? 0) >= LOGIN_MAX_FAILURES;
    },
    recordFailure(ip) {
      const now = clock.now();
      prune(now);
      const list = failures.get(ip) ?? [];
      list.push(now);
      failures.set(ip, list);
    },
  };
}

// ---------- middlewares ----------

export interface AuthDeps {
  db: Db;
  clock: Clock;
  cookieSecure: boolean;
  /** Current one-time setup code while setup is pending; undefined otherwise. */
  setupCode?: () => string | undefined;
  rateLimiter?: LoginRateLimiter;
  ipOf?: (c: Context) => string;
}

export function defaultIpOf(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const PASSWORD_CHANGE_PATH = '/api/account/password';

export function requireSession(
  deps: Pick<AuthDeps, 'db' | 'clock' | 'cookieSecure'>,
): MiddlewareHandler {
  return async (c, next) => {
    const user = authenticate(c, deps);
    if (!user) {
      return c.json(apiError('unauthorized', 'Login required'), 401);
    }
    if (user.mustChangePassword && c.req.path !== PASSWORD_CHANGE_PATH) {
      return c.json(
        apiError('password_change_required', 'Change your password first'),
        403,
      );
    }
    await next();
  };
}

/** Must run after `requireSession`; the role is the one read for this request. */
export function requireAdmin(): MiddlewareHandler {
  return async (c, next) => {
    if (c.get('user').role !== 'admin') {
      return c.json(apiError('forbidden', 'Administrators only'), 403);
    }
    await next();
  };
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function originCheck(): MiddlewareHandler {
  return async (c, next) => {
    if (STATE_CHANGING.has(c.req.method)) {
      const origin = c.req.header('Origin');
      const host = c.req.header('Host');
      let ok = false;
      if (origin && host) {
        try {
          ok = new URL(origin).host === host;
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        return c.json(
          apiError('forbidden_origin', 'Origin does not match host'),
          403,
        );
      }
    }
    await next();
  };
}

// ---------- setup code, hash takeover ----------

/** No look-alikes (0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/** `XXXXX-XXXXX` */
export function generateSetupCode(): string {
  return `${randomCode(5)}-${randomCode(5)}`;
}

/** 16 characters, for admin-created and reset accounts. */
export function generateTemporaryPassword(): string {
  return randomCode(16);
}

function normalizeCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

/** Constant-time comparison (digests have equal length). */
export function setupCodeMatches(expected: string, given: string): boolean {
  const digest = (v: string) =>
    createHash('sha256').update(normalizeCode(v)).digest();
  return timingSafeEqual(digest(expected), digest(given));
}

/** Setup is required while no account has a password. */
export function isSetupRequired(db: Db): boolean {
  return !db
    .select({ id: users.id })
    .from(users)
    .where(isNotNull(users.passwordHash))
    .get();
}

/**
 * Startup: adopts `ADMIN_PASSWORD_HASH` as the password of the first account while
 * no account has a password. Returns true when it was adopted.
 */
export function applyHashTakeover(
  db: Db,
  hash: string | undefined,
  logger: Pick<Logger, 'info'>,
): boolean {
  if (!hash) return false;
  if (!isSetupRequired(db) || !ADMIN_PASSWORD_HASH_RE.test(hash)) {
    logger.info(
      'ADMIN_PASSWORD_HASH has no effect anymore and can be removed from the environment',
    );
    return false;
  }
  const first = db
    .select({ id: users.id })
    .from(users)
    .orderBy(asc(users.id))
    .get();
  if (!first) return false;
  db.update(users)
    .set({ passwordHash: hash, role: 'admin', mustChangePassword: false })
    .where(eq(users.id, first.id))
    .run();
  logger.info(
    'ADMIN_PASSWORD_HASH adopted as the password of the account "admin"; the variable can be removed from the environment',
  );
  return true;
}

// ---------- routes ----------

// Verified against when the username is unknown, so both failures take equally long.
let dummyHash: string | undefined;
function verifyAgainstDummy(pw: string): void {
  dummyHash ??= hashPassword(randomBytes(8).toString('hex'));
  verifyPassword(pw, dummyHash);
}

function fieldErrors(error: {
  issues: readonly { path: PropertyKey[]; message: string }[];
}): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    const list = fields[key] ?? [];
    list.push(issue.message);
    fields[key] = list;
  }
  return fields;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/** Fills the first account (username, email, password, role admin) and makes its email a recipient. */
function claimFirstAccount(
  db: Db,
  input: { username: string; email: string; password: string },
  now: number,
): number | undefined {
  return db.transaction((tx) => {
    const t = tx as unknown as Db;
    if (!isSetupRequired(t)) return undefined;
    const first = t
      .select({ id: users.id })
      .from(users)
      .orderBy(asc(users.id))
      .get();
    const values = {
      username: input.username,
      email: input.email,
      passwordHash: hashPassword(input.password),
      role: 'admin' as const,
      mustChangePassword: false,
    };
    let id: number;
    if (first) {
      t.update(users).set(values).where(eq(users.id, first.id)).run();
      id = first.id;
    } else {
      id = t
        .insert(users)
        .values({ ...values, createdAt: now })
        .returning({ id: users.id })
        .get().id;
    }
    t.insert(userRecipients)
      .values({ userId: id, email: input.email })
      .onConflictDoNothing()
      .run();
    return id;
  });
}

/** Sub-app to be mounted under `/api/auth`. */
export function createAuthRoutes(deps: AuthDeps) {
  const { db, clock } = deps;
  const limiter = deps.rateLimiter ?? createLoginRateLimiter(clock);
  const ipOf = deps.ipOf ?? defaultIpOf;
  const tooMany = (c: Context) =>
    c.json(apiError('rate_limited', 'Too many failed attempts'), 429);
  return new Hono()
    .get('/setup', (c) => c.json({ required: isSetupRequired(db) }))
    .post('/setup', async (c) => {
      if (!isSetupRequired(db)) {
        return c.json(apiError('setup_completed', 'Setup is done'), 409);
      }
      const ip = ipOf(c);
      if (limiter.isBlocked(ip)) return tooMany(c);
      const parsed = setupInput.safeParse(await readJson(c));
      if (!parsed.success) {
        return c.json(
          apiError(
            'validation_failed',
            'Invalid body',
            fieldErrors(parsed.error),
          ),
          400,
        );
      }
      const expected = deps.setupCode?.();
      if (!expected || !setupCodeMatches(expected, parsed.data.code)) {
        limiter.recordFailure(ip);
        return c.json(apiError('invalid_setup_code', 'Wrong setup code'), 401);
      }
      const id = claimFirstAccount(db, parsed.data, clock.now());
      if (id === undefined) {
        return c.json(apiError('setup_completed', 'Setup is done'), 409);
      }
      setSessionCookie(c, createSession(db, clock, id), deps.cookieSecure);
      return c.json({ authenticated: true as const });
    })
    .post('/login', async (c) => {
      const ip = ipOf(c);
      if (limiter.isBlocked(ip)) return tooMany(c);
      const parsed = loginInput.safeParse(await readJson(c));
      if (!parsed.success) {
        return c.json(apiError('validation_failed', 'Invalid body'), 400);
      }
      const { username, password } = parsed.data;
      const account = db
        .select({ id: users.id, hash: users.passwordHash })
        .from(users)
        .where(sql`lower(${users.username}) = lower(${username.trim()})`)
        .get();
      if (!account?.hash) {
        verifyAgainstDummy(password);
      }
      if (!account?.hash || !verifyPassword(password, account.hash)) {
        limiter.recordFailure(ip);
        return c.json(
          apiError('invalid_password', 'Wrong username or password'),
          401,
        );
      }
      setSessionCookie(
        c,
        createSession(db, clock, account.id),
        deps.cookieSecure,
      );
      return c.json({ authenticated: true as const });
    })
    .post('/logout', (c) => {
      deleteSession(db, getCookie(c, SESSION_COOKIE));
      deleteCookie(c, SESSION_COOKIE, {
        path: '/',
        secure: deps.cookieSecure,
      });
      return c.json({ authenticated: false as const });
    })
    .get('/me', (c) => {
      const user = authenticate(c, deps);
      if (!user) {
        return c.json(apiError('unauthorized', 'Login required'), 401);
      }
      return c.json(user);
    });
}

/** Sub-app to be mounted under `/api/account`: own password change. */
export function createAccountRoutes(
  deps: Pick<
    AuthDeps,
    'db' | 'clock' | 'cookieSecure' | 'rateLimiter' | 'ipOf'
  >,
) {
  const { db } = deps;
  const limiter = deps.rateLimiter ?? createLoginRateLimiter(deps.clock);
  const ipOf = deps.ipOf ?? defaultIpOf;
  const account = (id: number): Account | undefined => {
    const row = db.select().from(users).where(eq(users.id, id)).get();
    if (!row) return undefined;
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      recipients: getRecipients(db, id),
      mailLanguage: getMailLanguage(db, id),
    };
  };
  return new Hono()
    .use(requireSession(deps))
    .get('/', (c) => {
      const body = account(c.get('user').id);
      if (!body) return c.json(apiError('unauthorized', 'Login required'), 401);
      return c.json(body);
    })
    .patch('/', async (c) => {
      const parsed = patchAccountInput.safeParse(await readJson(c));
      if (!parsed.success) {
        return c.json(
          apiError(
            'validation_failed',
            'Invalid body',
            fieldErrors(parsed.error),
          ),
          400,
        );
      }
      const { id } = c.get('user');
      const input = parsed.data;
      db.transaction((tx) => {
        if (input.email !== undefined)
          tx.update(users)
            .set({ email: input.email })
            .where(eq(users.id, id))
            .run();
        if (input.recipients)
          setRecipients(tx as unknown as Db, id, input.recipients);
        if (input.mailLanguage)
          setMailLanguage(tx as unknown as Db, id, input.mailLanguage);
      });
      const body = account(id);
      if (!body) return c.json(apiError('unauthorized', 'Login required'), 401);
      return c.json(body);
    })
    .post('/password', async (c) => {
      const ip = ipOf(c);
      if (limiter.isBlocked(ip))
        return c.json(
          apiError('rate_limited', 'Too many failed attempts'),
          429,
        );
      const parsed = changePasswordInput.safeParse(await readJson(c));
      if (!parsed.success) {
        return c.json(
          apiError(
            'validation_failed',
            'Invalid body',
            fieldErrors(parsed.error),
          ),
          400,
        );
      }
      const { id } = c.get('user');
      const row = db
        .select({ hash: users.passwordHash })
        .from(users)
        .where(eq(users.id, id))
        .get();
      if (
        !row?.hash ||
        !verifyPassword(parsed.data.currentPassword, row.hash)
      ) {
        limiter.recordFailure(ip);
        return c.json(
          apiError('invalid_password', 'Current password is wrong'),
          400,
        );
      }
      db.transaction((tx) => {
        tx.update(users)
          .set({
            passwordHash: hashPassword(parsed.data.newPassword),
            mustChangePassword: false,
          })
          .where(eq(users.id, id))
          .run();
        tx.delete(sessions)
          .where(
            and(eq(sessions.userId, id), ne(sessions.id, c.get('sessionId'))),
          )
          .run();
      });
      return c.json({ ok: true as const });
    });
}
