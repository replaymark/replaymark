import { eq } from 'drizzle-orm';
import type { DbHandle } from '../../src/db/client.ts';
import {
  follows,
  gameGroups,
  userRecipients,
  users,
} from '../../src/db/schema.ts';
import { type AdminAppDeps, createAdminApp } from '../../src/http/admin.ts';
import { createSession, SESSION_COOKIE } from '../../src/http/auth.ts';
import type { Mailer, OutgoingMail } from '../../src/mail/mailer.ts';
import type { TwitchCategory, TwitchUser } from '../../src/twitch/helix.ts';
import { createFakeClock, type FakeClock } from './clock.ts';
import { createTestDb } from './db.ts';
import { OWNER_ID } from './seed.ts';

export const HOST = 'admin.local:8081';
export const ORIGIN = `http://${HOST}`;

export interface FakeHelix {
  users: TwitchUser[];
  games: TwitchCategory[];
  search: TwitchCategory[];
  fail: boolean;
  calls: { method: string; arg: unknown }[];
  getUsersByLogin(logins: readonly string[]): Promise<TwitchUser[]>;
  searchCategories(q: string): Promise<TwitchCategory[]>;
  getGames(input: { ids?: readonly string[] }): Promise<TwitchCategory[]>;
}

export function createFakeHelix(): FakeHelix {
  const h: FakeHelix = {
    users: [],
    games: [],
    search: [],
    fail: false,
    calls: [],
    async getUsersByLogin(logins) {
      h.calls.push({ method: 'getUsersByLogin', arg: logins });
      if (h.fail) throw new Error('helix down');
      return h.users.filter((u) => logins.includes(u.login));
    },
    async searchCategories(q) {
      h.calls.push({ method: 'searchCategories', arg: q });
      if (h.fail) throw new Error('helix down');
      return h.search;
    },
    async getGames(input) {
      h.calls.push({ method: 'getGames', arg: input });
      if (h.fail) throw new Error('helix down');
      return h.games.filter((g) => input.ids?.includes(g.id));
    },
  };
  return h;
}

export interface AdminHarness {
  handle: DbHandle;
  clock: FakeClock;
  helix: FakeHelix;
  debounced: string[];
  requested: string[];
  retried: number[];
  woken: number;
  sent: OutgoingMail[];
  app: ReturnType<typeof createAdminApp>;
  cookie: string;
  /** Request with a valid session cookie plus matching Host/Origin. */
  req(path: string, init?: RequestInit & { json?: unknown }): Promise<Response>;
}

export function createAdminHarness(
  overrides: Partial<AdminAppDeps> = {},
): AdminHarness {
  const handle = createTestDb();
  const clock = createFakeClock();
  const helix = createFakeHelix();
  const h = {
    handle,
    clock,
    helix,
    debounced: [] as string[],
    requested: [] as string[],
    retried: [] as number[],
    woken: 0,
    sent: [] as OutgoingMail[],
  };
  const mailer: Mailer = {
    async send(mail) {
      h.sent.push(mail);
    },
  };
  const silent = { debug() {}, info() {}, warn() {}, error() {} };
  const app = createAdminApp({
    db: handle.db,
    clock,
    logger: silent,
    helix,
    reconciler: {
      async request(reason) {
        h.requested.push(reason);
      },
      requestDebounced(reason) {
        h.debounced.push(reason);
      },
    },
    outbox: {
      retry(id) {
        h.retried.push(id);
        return false;
      },
      wake() {
        h.woken++;
      },
    },
    mailer,
    callbackUrl: 'https://example.org/webhook',
    cookieSecure: false,
    ipOf: () => '1.2.3.4',
    ...overrides,
  });
  // Sessions of accounts without a password hash are rejected.
  handle.db
    .update(users)
    .set({ passwordHash: 'x' })
    .where(eq(users.id, OWNER_ID))
    .run();
  const cookie = createSession(handle.db, clock, OWNER_ID);
  const harness: AdminHarness = {
    ...h,
    get woken() {
      return h.woken;
    },
    app,
    cookie,
    req(path, init = {}) {
      const { json, ...rest } = init;
      const headers = new Headers(rest.headers);
      headers.set('Host', HOST);
      if (!headers.has('Origin')) headers.set('Origin', ORIGIN);
      if (!headers.has('Cookie'))
        headers.set('Cookie', `${SESSION_COOKIE}=${cookie}`);
      let body = rest.body;
      if (json !== undefined) {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(json);
      }
      return Promise.resolve(
        app.request(`http://${HOST}${path}`, { ...rest, headers, body }),
      );
    },
  };
  return harness;
}

export interface Account {
  id: number;
  req: AdminHarness['req'];
}

/** Adds an account (default group, one recipient) and a request helper acting as it. */
export function seedAccount(
  t: AdminHarness,
  username: string,
  role: 'admin' | 'user' = 'user',
): Account {
  const { db } = t.handle;
  const id = db
    .insert(users)
    .values({
      username,
      email: `${username}@x.org`,
      passwordHash: 'x',
      role,
      createdAt: t.clock.now(),
    })
    .returning({ id: users.id })
    .get().id;
  db.insert(gameGroups)
    .values({ ownerId: id, name: 'Default', isDefault: true })
    .run();
  db.insert(userRecipients)
    .values({ userId: id, email: `${username}@x.org` })
    .run();
  const cookie = createSession(db, t.clock, id);
  return {
    id,
    req: (path, init = {}) =>
      t.req(path, {
        ...init,
        headers: { ...init.headers, Cookie: `${SESSION_COOKIE}=${cookie}` },
      }),
  };
}

/** Makes the account follow a seeded broadcaster. */
export function followAs(
  t: AdminHarness,
  accountId: number,
  broadcasterId: string,
  mode: 'default' | 'custom' | 'any' = 'default',
): void {
  t.handle.db
    .insert(follows)
    .values({ ownerId: accountId, broadcasterId, gameMode: mode })
    .run();
}
