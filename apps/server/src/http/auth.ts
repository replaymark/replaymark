import {
  createHash,
  randomBytes,
  randomInt,
  type ScryptOptions,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { isIPv6 } from 'node:net';
import { promisify } from 'node:util';
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

/**
 * Cost of new hashes (128 MiB per hash). The env override is honoured under Vitest
 * only; production always uses 2^17.
 */
const SCRYPT_N = (() => {
  if (!process.env.VITEST) return 2 ** 17;
  const test = Number(process.env.REPLAYMARK_TEST_SCRYPT_N);
  return Number.isInteger(test) && test >= 2 && (test & (test - 1)) === 0
    ? test
    : 2 ** 17;
})();
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 32;
const KEY_BYTES = 64;

function maxmemFor(n: number, r: number, p: number): number {
  return 128 * n * r * p + 128 * r * (p + 2) + 1024 * 1024;
}

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/** At most this many scrypt runs (128 MiB each at N=2^17) are in flight at once. */
const MAX_CONCURRENT_HASHES = 2;
let activeHashes = 0;
/** Hashes waiting for a slot beyond this are refused instead of queued without bound. */
export const MAX_HASH_QUEUE = 32;
const hashWaiters: (() => void)[] = [];

/** Thrown before hashing when the wait queue is full; callers answer 429 `rate_limited`. */
export class HashQueueFullError extends Error {
  constructor() {
    super('password hashing queue is full');
    this.name = 'HashQueueFullError';
  }
}

async function withHashSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeHashes >= MAX_CONCURRENT_HASHES) {
    if (hashWaiters.length >= MAX_HASH_QUEUE) throw new HashQueueFullError();
    await new Promise<void>((resolve) => hashWaiters.push(resolve));
  } else {
    activeHashes++;
  }
  try {
    return await work();
  } finally {
    // Hand the slot straight to the next waiter, otherwise free it.
    const next = hashWaiters.shift();
    if (next) next();
    else activeHashes--;
  }
}

export async function hashPassword(
  pw: string,
  n: number = SCRYPT_N,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await withHashSlot(() =>
    scryptAsync(pw, salt, KEY_BYTES, {
      N: n,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: maxmemFor(n, SCRYPT_R, SCRYPT_P),
    }),
  );
  return `scrypt$${n}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** True when `stored` is a valid-looking scrypt hash with lower cost than new hashes get. */
export function needsRehash(stored: string): boolean {
  const [scheme, n, r, p] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  return Number(n) < SCRYPT_N || Number(r) < SCRYPT_R || Number(p) < SCRYPT_P;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export async function verifyPassword(
  pw: string,
  stored: string,
): Promise<boolean> {
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
    const actual = await withHashSlot(() =>
      scryptAsync(pw, salt, expected.length, {
        N: n,
        r,
        p,
        maxmem: maxmemFor(n, r, p),
      }),
    );
    return timingSafeEqual(actual, expected);
  } catch (error) {
    if (error instanceof HashQueueFullError) throw error;
    return false;
  }
}

// ---------- sessions ----------

export const SESSION_COOKIE = 'replaymark_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Absolute cap: a session ends this long after login, however active. */
export const SESSION_MAX_MS = 90 * 24 * 60 * 60 * 1000;
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
      createdAt: sessions.createdAt,
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
  const hardEnd = row.createdAt + SESSION_MAX_MS;
  if (row.expiresAt <= now || hardEnd <= now) {
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
      .set({
        expiresAt: Math.min(now + SESSION_TTL_MS, hardEnd),
        lastSeenAt: now,
      })
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

export const LOGIN_MAX_FAILURES_PER_USERNAME = 10;
/** Upper bound of tracked keys per map; at capacity the stalest key below the limit is evicted. */
export const LIMITER_MAX_KEYS = 10_000;
/** A full map is swept for expired keys at most this often. */
const LIMITER_PRUNE_INTERVAL_MS = 60 * 1000;

export interface LoginRateLimiter {
  /** Failures plus in-flight attempts of the keys have reached the limit. */
  isBlocked(ip: string, username?: string): boolean;
  recordFailure(ip: string, username?: string): void;
  /**
   * Atomically checks the limits and reserves an attempt slot (counted like a failure
   * until released). Undefined when blocked. Call before the first await of a check.
   */
  reserve(ip: string, username?: string): (() => void) | undefined;
}

const limiterKey = (username: string) => username.trim().toLowerCase();

/** Expands an IPv6 address into its 8 hextets; undefined when malformed. */
function ipv6Groups(ip: string): number[] | undefined {
  const [head = '', tail, extra] = ip.split('::');
  if (extra !== undefined) return undefined;
  const toGroups = (part: string): number[] =>
    part === '' ? [] : part.split(':').map((g) => Number.parseInt(g, 16));
  const first = toGroups(head);
  if (tail === undefined) return first.length === 8 ? first : undefined;
  const last = toGroups(tail);
  const fill = 8 - first.length - last.length;
  if (fill < 1) return undefined;
  return [...first, ...new Array<number>(fill).fill(0), ...last];
}

/**
 * Limiter key of a client address: IPv4 as is, IPv4-mapped IPv6 as the IPv4 address,
 * other IPv6 as its /64 prefix (one subscriber controls a whole /64).
 */
export function ipLimiterKey(raw: string): string {
  let ip = raw.trim().toLowerCase();
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (dotted?.[1]) return dotted[1];
  if (!isIPv6(ip)) return ip;
  const hextets = ip.includes('.') ? undefined : ipv6Groups(ip);
  if (!hextets || hextets.some((g) => !Number.isInteger(g))) return ip;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = hextets as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff)
    return `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`;
  return `${[g0, g1, g2, g3].map((g) => g.toString(16)).join(':')}::/64`;
}

/** In-memory: failures inside a sliding 15 min window, per IP (5) and per username (10). */
export function createLoginRateLimiter(clock: Clock): LoginRateLimiter {
  interface Tracker {
    map: Map<string, number[]>;
    inflight: Map<string, number>;
    limit: number;
    prunedAt: number;
  }
  const tracker = (limit: number): Tracker => ({
    map: new Map(),
    inflight: new Map(),
    limit,
    prunedAt: Number.NEGATIVE_INFINITY,
  });
  const byIp = tracker(LOGIN_MAX_FAILURES);
  const byName = tracker(LOGIN_MAX_FAILURES_PER_USERNAME);
  const recent = (map: Map<string, number[]>, key: string, now: number) => {
    const times = map.get(key);
    if (!times) return [];
    const kept = times.filter((t) => now - t < LOGIN_WINDOW_MS);
    if (kept.length === 0) map.delete(key);
    else if (kept.length !== times.length) map.set(key, kept);
    return kept;
  };
  const pending = (t: Tracker, key: string) => t.inflight.get(key) ?? 0;
  const count = (t: Tracker, key: string, now: number) =>
    recent(t.map, key, now).length + pending(t, key);
  /** Sweeps expired keys from a full map, at most once per prune interval. */
  const prune = (t: Tracker, now: number) => {
    if (now - t.prunedAt < LIMITER_PRUNE_INTERVAL_MS) return;
    t.prunedAt = now;
    for (const k of [...t.map.keys()]) recent(t.map, k, now);
  };
  /** True when `key` can be tracked: known, free space, or a key below the limit to evict. */
  const hasRoom = (t: Tracker, key: string, now: number) => {
    if (t.map.has(key) || t.map.size < LIMITER_MAX_KEYS) return true;
    prune(t, now);
    if (t.map.size < LIMITER_MAX_KEYS) return true;
    for (const times of t.map.values()) if (times.length < t.limit) return true;
    return false;
  };
  /** Evicts the key below the limit whose last failure is oldest. */
  const evictOldest = (t: Tracker) => {
    let victim: string | undefined;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [k, times] of t.map) {
      const last = times[times.length - 1] ?? 0;
      if (times.length < t.limit && last < oldest) {
        oldest = last;
        victim = k;
      }
    }
    if (victim !== undefined) t.map.delete(victim);
    return victim !== undefined;
  };
  const record = (t: Tracker, key: string, now: number) => {
    if (!t.map.has(key) && t.map.size >= LIMITER_MAX_KEYS) {
      prune(t, now);
      if (t.map.size >= LIMITER_MAX_KEYS && !evictOldest(t)) return;
    }
    const list = recent(t.map, key, now);
    list.push(now);
    t.map.set(key, list);
  };
  const blocked = (t: Tracker, key: string, now: number) =>
    !hasRoom(t, key, now) || count(t, key, now) >= t.limit;
  const isBlocked = (ip: string, username?: string) => {
    const now = clock.now();
    if (blocked(byIp, ipLimiterKey(ip), now)) return true;
    return username !== undefined && blocked(byName, limiterKey(username), now);
  };
  const bump = (t: Tracker, key: string, by: number) => {
    const n = pending(t, key) + by;
    if (n <= 0) t.inflight.delete(key);
    else t.inflight.set(key, n);
  };
  return {
    isBlocked,
    recordFailure(ip, username) {
      const now = clock.now();
      record(byIp, ipLimiterKey(ip), now);
      if (username !== undefined) record(byName, limiterKey(username), now);
    },
    reserve(ip, username) {
      if (isBlocked(ip, username)) return undefined;
      const ipKey = ipLimiterKey(ip);
      const nameKey = username === undefined ? undefined : limiterKey(username);
      bump(byIp, ipKey, 1);
      if (nameKey !== undefined) bump(byName, nameKey, 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        bump(byIp, ipKey, -1);
        if (nameKey !== undefined) bump(byName, nameKey, -1);
      };
    },
  };
}

// ---------- middlewares ----------

export interface AuthDeps {
  db: Db;
  clock: Clock;
  cookieSecure: boolean;
  /** Mail language of new accounts and UI fallback (`DEFAULT_LANGUAGE`). */
  defaultLanguage?: 'en' | 'de';
  /** Current one-time setup code while setup is pending; undefined otherwise. */
  setupCode?: () => string | undefined;
  rateLimiter?: LoginRateLimiter;
  ipOf?: (c: Context) => string;
  /** Failed logins take at least this long (ms); default 400. Injectable for tests. */
  minFailureMs?: number;
  /** Hashes the dummy password for unknown usernames; default `hashPassword`. Injectable for tests. */
  dummyHasher?: (pw: string) => Promise<string>;
}

export const MIN_FAILURE_MS = 400;

/** Waits until `minMs` have passed since `startedAt` (monotonic ms). */
async function padTo(startedAt: number, minMs: number): Promise<void> {
  const wait = minMs - (performance.now() - startedAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
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
  input: { username: string; email: string },
  passwordHash: string,
  now: number,
  mailLanguage: 'en' | 'de',
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
      passwordHash,
      role: 'admin' as const,
      mustChangePassword: false,
      mailLanguage,
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
  // Verified against when the username is unknown, so both failures take equally long.
  // A rejected computation is dropped so the next attempt retries it.
  let dummyHash: Promise<string> | undefined;
  const verifyAgainstDummy = async (pw: string): Promise<void> => {
    dummyHash ??= (deps.dummyHasher ?? hashPassword)(
      randomBytes(8).toString('hex'),
    ).catch((error: unknown) => {
      dummyHash = undefined;
      throw error;
    });
    try {
      await verifyPassword(pw, await dummyHash);
    } catch (error) {
      // Only a full queue changes the answer, and it does so for known users too.
      if (error instanceof HashQueueFullError) throw error;
    }
  };
  /** Upgrades an old hash; skipped when the hash queue is full, the next login retries. */
  const rehash = async (id: number, old: string, password: string) => {
    let next: string;
    try {
      next = await hashPassword(password);
    } catch (error) {
      if (error instanceof HashQueueFullError) return;
      throw error;
    }
    db.update(users)
      .set({ passwordHash: next })
      .where(and(eq(users.id, id), eq(users.passwordHash, old)))
      .run();
  };
  return new Hono()
    .get('/setup', (c) =>
      c.json({
        required: isSetupRequired(db),
        defaultLanguage: deps.defaultLanguage ?? 'en',
      }),
    )
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
      let passwordHash: string;
      try {
        passwordHash = await hashPassword(parsed.data.password);
      } catch (error) {
        if (error instanceof HashQueueFullError) return tooMany(c);
        throw error;
      }
      const id = claimFirstAccount(
        db,
        parsed.data,
        passwordHash,
        clock.now(),
        deps.defaultLanguage ?? 'en',
      );
      if (id === undefined) {
        return c.json(apiError('setup_completed', 'Setup is done'), 409);
      }
      setSessionCookie(c, createSession(db, clock, id), deps.cookieSecure);
      return c.json({ authenticated: true as const });
    })
    .post('/login', async (c) => {
      const startedAt = performance.now();
      const ip = ipOf(c);
      if (limiter.isBlocked(ip)) return tooMany(c);
      const parsed = loginInput.safeParse(await readJson(c));
      if (!parsed.success) {
        return c.json(apiError('validation_failed', 'Invalid body'), 400);
      }
      const { username, password } = parsed.data;
      // Reserved before the first await so parallel attempts cannot all pass the check.
      const release = limiter.reserve(ip, username);
      if (!release) return tooMany(c);
      try {
        const account = db
          .select({ id: users.id, hash: users.passwordHash })
          .from(users)
          .where(sql`lower(${users.username}) = lower(${username.trim()})`)
          .get();
        if (!account?.hash) await verifyAgainstDummy(password);
        if (!account?.hash || !(await verifyPassword(password, account.hash))) {
          limiter.recordFailure(ip, username);
          release();
          // Same duration whatever the stored hash cost, or whether the user exists.
          await padTo(startedAt, deps.minFailureMs ?? MIN_FAILURE_MS);
          return c.json(
            apiError('invalid_password', 'Wrong username or password'),
            401,
          );
        }
        if (needsRehash(account.hash))
          await rehash(account.id, account.hash, password);
        setSessionCookie(
          c,
          createSession(db, clock, account.id),
          deps.cookieSecure,
        );
        return c.json({ authenticated: true as const });
      } catch (error) {
        if (error instanceof HashQueueFullError) return tooMany(c);
        throw error;
      } finally {
        release();
      }
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
      const tooMany = () =>
        c.json(apiError('rate_limited', 'Too many failed attempts'), 429);
      if (limiter.isBlocked(ip)) return tooMany();
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
      const release = limiter.reserve(ip);
      if (!release) return tooMany();
      let newHash: string;
      try {
        const row = db
          .select({ hash: users.passwordHash })
          .from(users)
          .where(eq(users.id, id))
          .get();
        if (
          !row?.hash ||
          !(await verifyPassword(parsed.data.currentPassword, row.hash))
        ) {
          limiter.recordFailure(ip);
          return c.json(
            apiError('invalid_password', 'Current password is wrong'),
            400,
          );
        }
        newHash = await hashPassword(parsed.data.newPassword);
      } catch (error) {
        if (error instanceof HashQueueFullError) return tooMany();
        throw error;
      } finally {
        release();
      }
      db.transaction((tx) => {
        tx.update(users)
          .set({
            passwordHash: newHash,
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
