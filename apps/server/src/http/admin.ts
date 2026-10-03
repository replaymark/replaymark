import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  max,
  ne,
  sql,
} from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import type { ValidationTargets } from 'hono/types';
import { validator } from 'hono/validator';
import type { z } from 'zod';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import {
  categories,
  follows,
  gameGroupCategories,
  gameGroups,
  liveState,
  mailOutbox,
  sessions,
  streamerGames,
  streamerGroups,
  streamers,
  streams,
  subscriptions,
  userRecipients,
  users,
} from '../db/schema.ts';
import {
  getAllSettings,
  getMeta,
  getRecipients,
  setSetting,
} from '../db/settings.ts';
import type { Logger } from '../log.ts';
import { type Mailer, sendTestMail } from '../mail/mailer.ts';
import type { OutboxPayload } from '../notify/check.ts';
import { categoryMatches } from '../notify/match.ts';
import { apiError } from '../shared/errors.ts';
import type { SyncResult } from '../shared/events.ts';
import {
  addStreamerInput,
  type Category,
  categorySearchQuery,
  createGameGroupInput,
  createUserInput,
  type GameGroup,
  lookupStreamerQuery,
  type NotificationCounts,
  type NotificationItem,
  type NotificationPage,
  notificationsQuery,
  type Overview,
  patchGameGroupInput,
  patchStreamerInput,
  patchUserInput,
  type Settings,
  type Streamer,
  type StreamerLookup,
  type StreamerMail,
  SUBSCRIPTION_TYPES,
  type Subscription,
  type SubscriptionState,
  type SyncResultDto,
  settingsInput,
  timelineQuery,
  type UserItem,
} from '../shared/schemas.ts';
import {
  queryRecordedCategories,
  queryStream,
  queryTimeline,
} from '../timeline/query.ts';
import { type RecorderDb, recordTransition } from '../timeline/record.ts';
import type { Helix } from '../twitch/helix.ts';
import {
  type AuthDeps,
  createAccountRoutes,
  createAuthRoutes,
  createLoginRateLimiter,
  generateTemporaryPassword,
  hashPassword,
  originCheck,
  requireAdmin,
  requireSession,
} from './auth.ts';
import { type SseDeps, sseHandler } from './sse.ts';

export interface AdminAppDeps {
  db: Db;
  clock: Clock;
  logger: Logger;
  helix: Pick<Helix, 'getUsersByLogin' | 'searchCategories' | 'getGames'>;
  reconciler: {
    request(reason: string): Promise<void>;
    requestDebounced(reason: string): void;
  };
  outbox: { retry(id: number): boolean; wake(): void };
  mailer: Mailer;
  /** PUBLIC_BASE_URL for the test mail's admin UI link. */
  adminUrl?: string;
  callbackUrl: string;
  cookieSecure: boolean;
  /** Current setup code while setup is pending. */
  setupCode?: AuthDeps['setupCode'];
  /** Directory of the built SPA; static serving is skipped when absent. */
  webDist?: string;
  ipOf?: AuthDeps['ipOf'];
  rateLimiter?: AuthDeps['rateLimiter'];
  /** Enables `GET /api/events`; without it the route answers 404. */
  events?: SseDeps;
}

export const CATEGORY_CACHE_MS = 60_000;

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; img-src 'self' https://static-cdn.jtvnw.net data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

// ---------- helpers ----------

class TwitchUnavailable extends Error {}
class UnknownCategory extends Error {
  readonly ids: string[];
  constructor(ids: string[]) {
    super(`Unknown category: ${ids.join(', ')}`);
    this.ids = ids;
  }
}

async function twitch<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new TwitchUnavailable(
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Zod validator whose parsed output flows into the RPC types. */
function zv<T extends keyof ValidationTargets, S extends z.ZodType>(
  target: T,
  schema: S,
) {
  return validator(target, (value, c) => {
    const r = schema.safeParse(value);
    if (!r.success) {
      const fields: Record<string, string[]> = {};
      for (const issue of r.error.issues) {
        const key = issue.path.join('.') || '_';
        const list = fields[key] ?? [];
        list.push(issue.message);
        fields[key] = list;
      }
      return c.json(
        apiError('validation_failed', 'Invalid input', fields),
        400,
      );
    }
    return r.data as z.output<S>;
  });
}

const userItem = (db: Db, id: number): UserItem | undefined => {
  const r = db.select().from(users).where(eq(users.id, id)).get();
  if (!r) return undefined;
  const n = db
    .select({ n: count() })
    .from(follows)
    .where(eq(follows.ownerId, id))
    .get();
  return {
    id: r.id,
    username: r.username,
    email: r.email,
    role: r.role,
    createdAt: new Date(r.createdAt).toISOString(),
    streamerCount: n?.n ?? 0,
    mustChangePassword: r.mustChangePassword,
  };
};

const adminCount = (db: Db): number =>
  db.select({ n: count() }).from(users).where(eq(users.role, 'admin')).get()
    ?.n ?? 0;

const iso = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null): string | null =>
  ms == null ? null : iso(ms);

export function syncDto(r: SyncResult | undefined): SyncResultDto | null {
  return r ? { ...r, at: iso(r.at) } : null;
}

function subState(status: string | undefined): SubscriptionState {
  if (status === undefined) return 'missing';
  if (status === 'enabled') return 'enabled';
  if (status === 'webhook_callback_verification_pending') return 'pending';
  return 'error';
}

function toCategory(row: typeof categories.$inferSelect): Category {
  return { id: row.categoryId, name: row.name, boxArtUrl: row.boxArtUrl };
}

export function upsertCategories(db: Db, list: Category[]): void {
  for (const c of list) {
    if (!c.id) continue;
    db.insert(categories)
      .values({ categoryId: c.id, name: c.name, boxArtUrl: c.boxArtUrl })
      .onConflictDoUpdate({
        target: categories.categoryId,
        set: { name: c.name, boxArtUrl: c.boxArtUrl },
      })
      .run();
  }
}

// ---------- queries ----------

const RESERVED_GROUP_NAMES: ReadonlySet<string> = new Set([
  'default',
  'default games',
  'standard-spiele',
]);

export function listGameGroups(
  db: Db,
  ownerId: number,
  onlyId?: number,
): GameGroup[] {
  const own = eq(gameGroups.ownerId, ownerId);
  const rows = (
    onlyId === undefined
      ? db.select().from(gameGroups).where(own).all()
      : db
          .select()
          .from(gameGroups)
          .where(and(own, eq(gameGroups.id, onlyId)))
          .all()
  ).sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name),
  );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const games = db
    .select({ groupId: gameGroupCategories.groupId, c: categories })
    .from(gameGroupCategories)
    .innerJoin(
      categories,
      eq(categories.categoryId, gameGroupCategories.categoryId),
    )
    .where(inArray(gameGroupCategories.groupId, ids))
    .all();
  const counts = new Map(
    db
      .select({ groupId: streamerGroups.groupId, n: count() })
      .from(streamerGroups)
      .innerJoin(
        follows,
        and(
          eq(follows.ownerId, streamerGroups.ownerId),
          eq(follows.broadcasterId, streamerGroups.userId),
        ),
      )
      .where(
        and(
          eq(streamerGroups.ownerId, ownerId),
          inArray(streamerGroups.groupId, ids),
          eq(follows.gameMode, 'custom'),
        ),
      )
      .groupBy(streamerGroups.groupId)
      .all()
      .map((r) => [r.groupId, r.n]),
  );
  const defaultCount =
    db
      .select({ n: count() })
      .from(follows)
      .where(and(eq(follows.ownerId, ownerId), eq(follows.gameMode, 'default')))
      .get()?.n ?? 0;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isDefault: r.isDefault,
    games: games
      .filter((g) => g.groupId === r.id)
      .map((g) => toCategory(g.c))
      .sort((a, b) => a.name.localeCompare(b.name)),
    streamerCount: r.isDefault ? defaultCount : (counts.get(r.id) ?? 0),
  }));
}

export function listStreamers(
  db: Db,
  ownerId: number,
  onlyId?: string,
): Streamer[] {
  const followed = db
    .select({
      ...getTableColumns(streamers),
      gameMode: follows.gameMode,
      enabled: follows.enabled,
    })
    .from(streamers)
    .innerJoin(
      follows,
      and(
        eq(follows.broadcasterId, streamers.userId),
        eq(follows.ownerId, ownerId),
      ),
    );
  const rows = onlyId
    ? followed.where(eq(streamers.userId, onlyId)).all()
    : followed.orderBy(streamers.login).all();
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.userId);
  const cats = new Map(
    db
      .select()
      .from(categories)
      .all()
      .map((c) => [c.categoryId, toCategory(c)]),
  );
  const games = db
    .select()
    .from(streamerGames)
    .where(
      and(
        eq(streamerGames.ownerId, ownerId),
        inArray(streamerGames.userId, ids),
      ),
    )
    .all();
  const groupRows = db
    .select({
      userId: streamerGroups.userId,
      id: gameGroups.id,
      name: gameGroups.name,
    })
    .from(streamerGroups)
    .innerJoin(gameGroups, eq(gameGroups.id, streamerGroups.groupId))
    .where(
      and(
        eq(streamerGroups.ownerId, ownerId),
        eq(gameGroups.ownerId, ownerId),
        inArray(streamerGroups.userId, ids),
      ),
    )
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const live = new Map(
    db
      .select()
      .from(liveState)
      .where(inArray(liveState.broadcasterId, ids))
      .all()
      .map((l) => [l.broadcasterId, l]),
  );
  const subs = db
    .select()
    .from(subscriptions)
    .where(inArray(subscriptions.broadcasterId, ids))
    .all();
  const lastLive = new Map(
    db
      .select({ id: streams.broadcasterId, at: max(streams.endedAt) })
      .from(streams)
      .where(inArray(streams.broadcasterId, ids))
      .groupBy(streams.broadcasterId)
      .all()
      .map((x) => [x.id, x.at]),
  );
  const liveStreamIds = [...live.values()].flatMap((l) =>
    l.streamId ? [l.streamId] : [],
  );
  // Newest row per stream wins: ids ascend, so the last one seen is newest.
  const mailByStream = new Map<string, StreamerMail>();
  if (liveStreamIds.length > 0) {
    const outbox = db
      .select({
        streamId: mailOutbox.streamId,
        status: mailOutbox.status,
        sentAt: mailOutbox.sentAt,
        updatedAt: mailOutbox.updatedAt,
        lastError: mailOutbox.lastError,
      })
      .from(mailOutbox)
      .where(
        and(
          eq(mailOutbox.ownerId, ownerId),
          inArray(mailOutbox.streamId, liveStreamIds),
        ),
      )
      .orderBy(mailOutbox.id)
      .all();
    for (const m of outbox) {
      mailByStream.set(m.streamId, {
        status: m.status,
        at: iso(m.sentAt ?? m.updatedAt),
        error: m.lastError,
      });
    }
  }

  return rows.map((r) => {
    const l = live.get(r.userId);
    const isLive = !!l?.streamId;
    const current =
      isLive && l?.categoryId
        ? (cats.get(l.categoryId) ?? {
            id: l.categoryId,
            name: l.categoryName ?? '',
            boxArtUrl: null,
          })
        : null;
    const subStates = {} as Record<
      (typeof SUBSCRIPTION_TYPES)[number],
      SubscriptionState
    >;
    for (const type of SUBSCRIPTION_TYPES) {
      const s = subs.find(
        (x) => x.broadcasterId === r.userId && x.type === type,
      );
      subStates[type] = subState(s?.status);
    }
    return {
      id: r.userId,
      login: r.login,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl,
      gameMode: r.gameMode,
      enabled: r.enabled,
      categories: games
        .filter((g) => g.userId === r.userId)
        .map(
          (g) =>
            cats.get(g.categoryId) ?? {
              id: g.categoryId,
              name: '',
              boxArtUrl: null,
            },
        ),
      groups: groupRows
        .filter((g) => g.userId === r.userId)
        .map((g) => ({ id: g.id, name: g.name })),
      live: isLive,
      streamId: isLive ? (l?.streamId ?? null) : null,
      title: isLive ? (l?.title ?? null) : null,
      startedAt: isLive ? isoOrNull(l?.startedAt ?? null) : null,
      currentCategory: current,
      matches: !!current && categoryMatches(db, r.userId, current.id, ownerId),
      subscriptions: subStates,
      lastLiveAt: isoOrNull(lastLive.get(r.userId) ?? null),
      mail: (isLive && l?.streamId && mailByStream.get(l.streamId)) || null,
      createdAt: iso(r.createdAt),
    };
  });
}

function readSettings(db: Db, callbackUrl: string): Settings {
  return { ...getAllSettings(db), callbackUrl };
}

function toNotification(
  row: typeof mailOutbox.$inferSelect,
  byId: Map<string, { login: string; displayName: string }>,
  owner: string | null,
): NotificationItem {
  let p: Partial<OutboxPayload> = {};
  try {
    p = JSON.parse(row.payload) as OutboxPayload;
  } catch {
    p = {};
  }
  const s = byId.get(row.broadcasterId);
  return {
    id: row.id,
    owner,
    streamId: row.streamId,
    broadcasterId: row.broadcasterId,
    login: p.login ?? s?.login ?? null,
    displayName: p.displayName ?? s?.displayName ?? null,
    categoryId: row.categoryId,
    gameName: p.gameName ?? null,
    boxArtUrl: p.boxArtUrl ?? null,
    title: p.title ?? null,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: iso(row.createdAt),
    sentAt: isoOrNull(row.sentAt),
    nextAttemptAt: row.status === 'pending' ? iso(row.nextAttemptAt) : null,
  };
}

// ---------- routes ----------

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT');
}

/** Typed `/api` routes; `AppType` for the web `hc` client. */
export function createAdminRoutes(deps: AdminAppDeps) {
  const { db, clock, helix, reconciler } = deps;
  const publishOffline = (broadcasterId: string) =>
    deps.events?.bus.publish('live-state', {
      broadcasterId,
      live: false,
      streamId: null,
      categoryId: null,
      categoryName: null,
      title: null,
      startedAt: null,
    });
  /**
   * Closes the broadcaster's open stream and segment at `now` as an approximate end
   * (paused or deleted while live). Run inside the live-state transaction; returns
   * the stream ids to publish a `timeline` event for.
   */
  const closeTimeline = (tx: RecorderDb, id: string): string[] => {
    const prev = tx
      .select()
      .from(liveState)
      .where(eq(liveState.broadcasterId, id))
      .get();
    const next = {
      broadcasterId: id,
      streamId: null,
      categoryId: null,
      categoryName: null,
      startedAt: null,
    };
    return recordTransition(tx, prev, next, clock.now(), true, false);
  };
  /**
   * After follows were removed: deletes broadcasters nobody follows anymore (with
   * their live state) and closes the live state of those nobody follows actively
   * (same as the pause path). Stream history stays. Returns the stream ids to
   * publish a `timeline` event for and the broadcaster ids to publish offline.
   */
  const settleBroadcasters = (
    tx: RecorderDb,
    ids: readonly string[],
  ): { closed: string[]; offline: string[] } => {
    const closed: string[] = [];
    const offline: string[] = [];
    for (const id of ids) {
      const left = tx
        .select({
          n: count(),
          active: sql<number>`coalesce(sum(${follows.enabled}), 0)`,
        })
        .from(follows)
        .where(eq(follows.broadcasterId, id))
        .get();
      if (left?.n && left.active) continue;
      const wasLive = !!tx
        .select({ s: liveState.streamId })
        .from(liveState)
        .where(eq(liveState.broadcasterId, id))
        .get()?.s;
      closed.push(...closeTimeline(tx, id));
      if (left?.n) {
        tx.update(liveState)
          .set({ streamId: null, updatedAt: clock.now() })
          .where(eq(liveState.broadcasterId, id))
          .run();
        if (wasLive) offline.push(id);
        continue;
      }
      tx.delete(liveState).where(eq(liveState.broadcasterId, id)).run();
      tx.delete(streamers).where(eq(streamers.userId, id)).run();
      offline.push(id);
    }
    return { closed, offline };
  };
  const publishTimeline = (streamIds: readonly string[]) => {
    for (const streamId of streamIds)
      deps.events?.bus.publish('timeline', { streamId });
  };
  const searchCache = new Map<string, { at: number; data: Category[] }>();

  /** Ensures every id exists in `categories` (resolving missing ones via Helix). */
  async function ensureCategories(ids: readonly string[]): Promise<void> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const known = new Set(
      db
        .select({ id: categories.categoryId })
        .from(categories)
        .where(inArray(categories.categoryId, unique))
        .all()
        .map((r) => r.id),
    );
    const missing = unique.filter((id) => !known.has(id));
    if (missing.length === 0) return;
    const found = await twitch(() => helix.getGames({ ids: missing }));
    upsertCategories(db, found);
    const foundIds = new Set(found.map((c) => c.id));
    const still = missing.filter((id) => !foundIds.has(id));
    if (still.length > 0) throw new UnknownCategory(still);
  }

  function ownGroup(ownerId: number, id: number) {
    return Number.isInteger(id)
      ? db
          .select()
          .from(gameGroups)
          .where(and(eq(gameGroups.id, id), eq(gameGroups.ownerId, ownerId)))
          .get()
      : undefined;
  }

  function groupNameTaken(
    ownerId: number,
    name: string,
    exceptId?: number,
  ): boolean {
    const lower = name.toLowerCase();
    if (RESERVED_GROUP_NAMES.has(lower)) return true;
    return db
      .select({
        id: gameGroups.id,
        name: gameGroups.name,
        isDefault: gameGroups.isDefault,
      })
      .from(gameGroups)
      .where(eq(gameGroups.ownerId, ownerId))
      .all()
      .some(
        (g) =>
          !g.isDefault && g.id !== exceptId && g.name.toLowerCase() === lower,
      );
  }

  const events = deps.events ? sseHandler(deps.events) : undefined;

  const api = new Hono()
    .use(requireSession({ db, clock, cookieSecure: deps.cookieSecure }))
    .get('/events', (c) =>
      events ? events(c) : c.json(apiError('not_found', 'Not found'), 404),
    )
    .get('/overview', (c) => {
      const { id: me, role } = c.get('user');
      const list = listStreamers(db, me);
      const outbox = db
        .select({ status: mailOutbox.status, n: count() })
        .from(mailOutbox)
        .where(eq(mailOutbox.ownerId, me))
        .groupBy(mailOutbox.status)
        .all();
      const nOf = (s: string) => outbox.find((o) => o.status === s)?.n ?? 0;
      const lastFailed = db
        .select({ lastError: mailOutbox.lastError })
        .from(mailOutbox)
        .where(and(eq(mailOutbox.ownerId, me), eq(mailOutbox.status, 'failed')))
        .orderBy(desc(mailOutbox.updatedAt), desc(mailOutbox.id))
        .limit(1)
        .get();
      const enabled = list.filter((s) => s.enabled);
      const admin = role === 'admin';
      const subs = admin
        ? db.select({ status: subscriptions.status }).from(subscriptions).all()
        : [];
      const expectedBroadcasters = admin
        ? (db
            .select({
              n: sql<number>`count(distinct ${follows.broadcasterId})`,
            })
            .from(follows)
            .where(eq(follows.enabled, true))
            .get()?.n ?? 0)
        : 0;
      const body: Overview = {
        streamers: {
          total: list.length,
          enabled: enabled.length,
          live: list.filter((s) => s.live).length,
          matching: list.filter((s) => s.matches).length,
        },
        subscriptions: admin
          ? {
              active: subs.filter((s) => subState(s.status) !== 'error').length,
              expected: expectedBroadcasters * SUBSCRIPTION_TYPES.length,
            }
          : null,
        notifications: {
          pending: nOf('pending'),
          failed: nOf('failed'),
          lastError: lastFailed?.lastError ?? null,
        },
        recipients: getRecipients(db, me).length,
        lastSync: admin ? syncDto(getMeta<SyncResult>(db, 'last_sync')) : null,
      };
      return c.json(body);
    })
    .get('/streamers', (c) => c.json(listStreamers(db, c.get('user').id)))
    .get('/streamers/lookup', zv('query', lookupStreamerQuery), async (c) => {
      const { login } = c.req.valid('query');
      const [user] = await twitch(() => helix.getUsersByLogin([login]));
      if (!user) {
        return c.json(
          apiError('unknown_login', `Unknown login: ${login}`),
          404,
        );
      }
      const existing = db
        .select({ id: follows.broadcasterId })
        .from(follows)
        .where(
          and(
            eq(follows.ownerId, c.get('user').id),
            eq(follows.broadcasterId, user.id),
          ),
        )
        .get();
      const body: StreamerLookup = {
        id: user.id,
        login: user.login,
        displayName: user.displayName,
        avatarUrl: user.profileImageUrl || null,
        alreadyAdded: !!existing,
      };
      return c.json(body);
    })
    .post('/streamers', zv('json', addStreamerInput), async (c) => {
      const { login } = c.req.valid('json');
      const [user] = await twitch(() => helix.getUsersByLogin([login]));
      if (!user) {
        return c.json(
          apiError('unknown_login', `Unknown login: ${login}`),
          404,
        );
      }
      const me = c.get('user').id;
      const existing = db
        .select({ id: streamers.userId })
        .from(streamers)
        .where(eq(streamers.userId, user.id))
        .get();
      const info = {
        login: user.login,
        displayName: user.displayName,
        avatarUrl: user.profileImageUrl || null,
      };
      if (existing) {
        db.update(streamers)
          .set(info)
          .where(eq(streamers.userId, user.id))
          .run();
      } else {
        db.insert(streamers)
          .values({ userId: user.id, ...info, createdAt: clock.now() })
          .run();
      }
      const followed = db
        .insert(follows)
        .values({
          ownerId: me,
          broadcasterId: user.id,
          createdAt: clock.now(),
        })
        .onConflictDoNothing()
        .run();
      if (followed.changes > 0) reconciler.requestDebounced('streamer added');
      const [dto] = listStreamers(db, me, user.id);
      return c.json(dto as Streamer, followed.changes > 0 ? 201 : 200);
    })
    .patch('/streamers/:id', zv('json', patchStreamerInput), async (c) => {
      const id = c.req.param('id');
      const me = c.get('user').id;
      const input = c.req.valid('json');
      const row = db
        .select({ id: follows.broadcasterId, mode: follows.gameMode })
        .from(follows)
        .where(and(eq(follows.ownerId, me), eq(follows.broadcasterId, id)))
        .get();
      if (!row) return c.json(apiError('not_found', 'Unknown streamer'), 404);
      if (input.categoryIds) await ensureCategories(input.categoryIds);
      const resultingMode = input.gameMode ?? row.mode;
      const groupIds =
        resultingMode === 'custom'
          ? input.groupIds && [...new Set(input.groupIds)]
          : [];
      if (groupIds && groupIds.length > 0) {
        const found = db
          .select({ id: gameGroups.id, isDefault: gameGroups.isDefault })
          .from(gameGroups)
          .where(
            and(eq(gameGroups.ownerId, me), inArray(gameGroups.id, groupIds)),
          )
          .all();
        if (found.length !== groupIds.length)
          return c.json(apiError('unknown_group', 'Unknown game group'), 400);
        if (found.some((g) => g.isDefault))
          return c.json(
            apiError(
              'default_group_protected',
              'The default group is not assignable',
            ),
            400,
          );
      }
      // Live state is shared: only the last active follower pauses it.
      const othersActive =
        db
          .select({ n: count() })
          .from(follows)
          .where(
            and(
              eq(follows.broadcasterId, id),
              eq(follows.enabled, true),
              ne(follows.ownerId, me),
            ),
          )
          .get()?.n !== 0;
      const closesLive = input.enabled === false && !othersActive;
      const wasLive =
        closesLive &&
        !!db
          .select({ s: liveState.streamId })
          .from(liveState)
          .where(eq(liveState.broadcasterId, id))
          .get()?.s;
      const closed = db.transaction((tx) => {
        const set: Partial<typeof follows.$inferInsert> = {};
        if (input.gameMode !== undefined) set.gameMode = input.gameMode;
        if (input.enabled !== undefined) set.enabled = input.enabled;
        if (Object.keys(set).length > 0)
          tx.update(follows)
            .set(set)
            .where(and(eq(follows.ownerId, me), eq(follows.broadcasterId, id)))
            .run();
        const closed = closesLive ? closeTimeline(tx, id) : [];
        if (closesLive)
          tx.update(liveState)
            .set({ streamId: null, updatedAt: clock.now() })
            .where(eq(liveState.broadcasterId, id))
            .run();
        if (input.categoryIds) {
          tx.delete(streamerGames)
            .where(
              and(eq(streamerGames.ownerId, me), eq(streamerGames.userId, id)),
            )
            .run();
          const ids = [...new Set(input.categoryIds)];
          if (ids.length > 0)
            tx.insert(streamerGames)
              .values(
                ids.map((categoryId) => ({
                  ownerId: me,
                  userId: id,
                  categoryId,
                })),
              )
              .run();
        }
        if (groupIds) {
          tx.delete(streamerGroups)
            .where(
              and(
                eq(streamerGroups.ownerId, me),
                eq(streamerGroups.userId, id),
              ),
            )
            .run();
          if (groupIds.length > 0)
            tx.insert(streamerGroups)
              .values(
                groupIds.map((groupId) => ({
                  ownerId: me,
                  userId: id,
                  groupId,
                })),
              )
              .run();
        }
        return closed;
      });
      publishTimeline(closed);
      // A paused streamer gets no stream.offline anymore; mark it offline now.
      if (wasLive) publishOffline(id);
      reconciler.requestDebounced('streamer updated');
      const [dto] = listStreamers(db, me, id);
      return c.json(dto as Streamer);
    })
    .delete('/streamers/:id', (c) => {
      const id = c.req.param('id');
      const me = c.get('user').id;
      const deleted = db.transaction((tx) => {
        const res = tx
          .delete(follows)
          .where(and(eq(follows.ownerId, me), eq(follows.broadcasterId, id)))
          .run();
        if (res.changes === 0) return null;
        return settleBroadcasters(tx, [id]);
      });
      if (!deleted)
        return c.json(apiError('not_found', 'Unknown streamer'), 404);
      publishTimeline(deleted.closed);
      for (const gone of deleted.offline) publishOffline(gone);
      reconciler.requestDebounced('streamer deleted');
      return c.json({ ok: true as const });
    })
    .get('/game-groups', (c) => c.json(listGameGroups(db, c.get('user').id)))
    .post('/game-groups', zv('json', createGameGroupInput), async (c) => {
      const me = c.get('user').id;
      const input = c.req.valid('json');
      const ids = [...new Set(input.categoryIds)];
      if (groupNameTaken(me, input.name))
        return c.json(
          apiError('duplicate_name', 'A group with this name exists'),
          409,
        );
      await ensureCategories(ids);
      const id = db.transaction((tx) => {
        const row = tx
          .insert(gameGroups)
          .values({
            ownerId: me,
            name: input.name,
            createdAt: clock.now(),
          })
          .returning({ id: gameGroups.id })
          .get();
        if (ids.length > 0)
          tx.insert(gameGroupCategories)
            .values(ids.map((categoryId) => ({ groupId: row.id, categoryId })))
            .run();
        return row.id;
      });
      reconciler.requestDebounced('game groups changed');
      deps.events?.bus.publish('groups', {});
      const [dto] = listGameGroups(db, me, id);
      return c.json(dto as GameGroup, 201);
    })
    .patch('/game-groups/:id', zv('json', patchGameGroupInput), async (c) => {
      const id = Number(c.req.param('id'));
      const me = c.get('user').id;
      const input = c.req.valid('json');
      const row = ownGroup(me, id);
      if (!row) return c.json(apiError('not_found', 'Unknown group'), 404);
      if (input.name !== undefined && row.isDefault)
        return c.json(
          apiError('default_group_protected', 'The default group is fixed'),
          400,
        );
      if (input.name !== undefined && groupNameTaken(me, input.name, id))
        return c.json(
          apiError('duplicate_name', 'A group with this name exists'),
          409,
        );
      if (input.categoryIds) await ensureCategories(input.categoryIds);
      db.transaction((tx) => {
        if (input.name !== undefined)
          tx.update(gameGroups)
            .set({ name: input.name })
            .where(eq(gameGroups.id, id))
            .run();
        if (input.categoryIds) {
          tx.delete(gameGroupCategories)
            .where(eq(gameGroupCategories.groupId, id))
            .run();
          const ids = [...new Set(input.categoryIds)];
          if (ids.length > 0)
            tx.insert(gameGroupCategories)
              .values(ids.map((categoryId) => ({ groupId: id, categoryId })))
              .run();
        }
      });
      reconciler.requestDebounced('game groups changed');
      deps.events?.bus.publish('groups', {});
      const [dto] = listGameGroups(db, me, id);
      return c.json(dto as GameGroup);
    })
    .delete('/game-groups/:id', (c) => {
      const id = Number(c.req.param('id'));
      const row = ownGroup(c.get('user').id, id);
      if (!row) return c.json(apiError('not_found', 'Unknown group'), 404);
      if (row.isDefault)
        return c.json(
          apiError('default_group_protected', 'The default group is fixed'),
          400,
        );
      db.delete(gameGroups).where(eq(gameGroups.id, id)).run();
      reconciler.requestDebounced('game groups changed');
      deps.events?.bus.publish('groups', {});
      return c.json({ ok: true as const });
    })
    .get('/categories/search', zv('query', categorySearchQuery), async (c) => {
      const key = c.req.valid('query').q.toLowerCase();
      const now = clock.now();
      const hit = searchCache.get(key);
      if (hit && now - hit.at < CATEGORY_CACHE_MS) return c.json(hit.data);
      const found = await twitch(() => helix.searchCategories(key));
      const data: Category[] = found.map((f) => ({
        id: f.id,
        name: f.name,
        boxArtUrl: f.boxArtUrl || null,
      }));
      upsertCategories(db, data);
      for (const [k, v] of searchCache)
        if (now - v.at >= CATEGORY_CACHE_MS) searchCache.delete(k);
      searchCache.set(key, { at: now, data });
      return c.json(data);
    })
    .get('/settings', requireAdmin(), (c) =>
      c.json(readSettings(db, deps.callbackUrl)),
    )
    .put('/settings', requireAdmin(), zv('json', settingsInput), async (c) => {
      const input = c.req.valid('json');
      db.transaction((tx) => {
        setSetting(
          tx as unknown as Db,
          'syncIntervalHours',
          input.syncIntervalHours,
        );
        if (input.segmentRetentionDays !== undefined)
          setSetting(
            tx as unknown as Db,
            'segmentRetentionDays',
            input.segmentRetentionDays,
          );
      });
      return c.json(readSettings(db, deps.callbackUrl));
    })
    .get('/subscriptions', requireAdmin(), (c) => {
      const logins = new Map(
        db
          .select({ id: streamers.userId, login: streamers.login })
          .from(streamers)
          .all()
          .map((s) => [s.id, s.login]),
      );
      const body: Subscription[] = db
        .select()
        .from(subscriptions)
        .orderBy(subscriptions.broadcasterId, subscriptions.type)
        .all()
        .map((s) => ({
          id: s.twitchSubId,
          type: s.type,
          version: s.version,
          broadcasterId: s.broadcasterId,
          login: logins.get(s.broadcasterId) ?? null,
          status: s.status,
          state: subState(s.status),
          createdAt: iso(s.createdAt),
          updatedAt: iso(s.updatedAt),
        }));
      return c.json(body);
    })
    .post('/sync', requireAdmin(), async (c) => {
      await reconciler.request('manual');
      return c.json(syncDto(getMeta<SyncResult>(db, 'last_sync')));
    })
    .get('/users', requireAdmin(), (c) => {
      const ids = db
        .select({ id: users.id })
        .from(users)
        .orderBy(users.id)
        .all();
      const body: UserItem[] = [];
      for (const { id } of ids) {
        const item = userItem(db, id);
        if (item) body.push(item);
      }
      return c.json(body);
    })
    .post('/users', requireAdmin(), zv('json', createUserInput), (c) => {
      const input = c.req.valid('json');
      const taken = db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.username}) = ${input.username}`)
        .get();
      if (taken)
        return c.json(apiError('username_taken', 'Username taken'), 409);
      const temporaryPassword = generateTemporaryPassword();
      const now = clock.now();
      let id: number;
      try {
        id = createUserRow();
      } catch (e) {
        if (isUniqueViolation(e))
          return c.json(apiError('username_taken', 'Username taken'), 409);
        throw e;
      }
      return c.json({ user: userItem(db, id), temporaryPassword }, 201);
      function createUserRow(): number {
        return db.transaction((tx) => {
          const uid = tx
            .insert(users)
            .values({
              username: input.username,
              email: input.email,
              passwordHash: hashPassword(temporaryPassword),
              role: input.role,
              mustChangePassword: true,
              mailLanguage: 'de',
              createdAt: now,
            })
            .returning({ id: users.id })
            .get().id;
          tx.insert(gameGroups)
            .values({
              ownerId: uid,
              name: 'Default',
              isDefault: true,
              createdAt: now,
            })
            .run();
          tx.insert(userRecipients)
            .values({ userId: uid, email: input.email })
            .run();
          return uid;
        });
      }
    })
    .patch('/users/:id', requireAdmin(), zv('json', patchUserInput), (c) => {
      const id = Number(c.req.param('id'));
      const input = c.req.valid('json');
      const target = Number.isInteger(id)
        ? db.select().from(users).where(eq(users.id, id)).get()
        : undefined;
      if (!target) return c.json(apiError('not_found', 'Unknown user'), 404);
      if (
        input.role === 'user' &&
        target.role === 'admin' &&
        adminCount(db) <= 1
      )
        return c.json(apiError('last_admin', 'Last administrator'), 409);
      const temporaryPassword = input.resetPassword
        ? generateTemporaryPassword()
        : undefined;
      db.transaction((tx) => {
        if (input.role) {
          tx.update(users)
            .set({ role: input.role })
            .where(eq(users.id, id))
            .run();
        }
        if (temporaryPassword) {
          tx.update(users)
            .set({
              passwordHash: hashPassword(temporaryPassword),
              mustChangePassword: true,
            })
            .where(eq(users.id, id))
            .run();
          tx.delete(sessions).where(eq(sessions.userId, id)).run();
        }
      });
      return c.json(
        temporaryPassword
          ? { user: userItem(db, id), temporaryPassword }
          : { user: userItem(db, id) },
      );
    })
    .delete('/users/:id', requireAdmin(), (c) => {
      const id = Number(c.req.param('id'));
      if (id === c.get('user').id)
        return c.json(apiError('cannot_delete_self', 'Own account'), 409);
      const target = Number.isInteger(id)
        ? db.select().from(users).where(eq(users.id, id)).get()
        : undefined;
      if (!target) return c.json(apiError('not_found', 'Unknown user'), 404);
      if (target.role === 'admin' && adminCount(db) <= 1)
        return c.json(apiError('last_admin', 'Last administrator'), 409);
      const deleted = db.transaction((tx) => {
        const followed = tx
          .select({ id: follows.broadcasterId, enabled: follows.enabled })
          .from(follows)
          .where(eq(follows.ownerId, id))
          .all();
        tx.delete(users).where(eq(users.id, id)).run();
        return {
          ...settleBroadcasters(
            tx,
            followed.map((f) => f.id),
          ),
          hadEnabled: followed.some((f) => f.enabled),
        };
      });
      publishTimeline(deleted.closed);
      for (const gone of deleted.offline) publishOffline(gone);
      if (deleted.hadEnabled) reconciler.requestDebounced('user deleted');
      return c.json({ ok: true as const });
    })
    .get('/notifications', zv('query', notificationsQuery), (c) => {
      const { id: me, role } = c.get('user');
      const admin = role === 'admin';
      const { page, pageSize, status: statuses } = c.req.valid('query');
      const scope = admin ? undefined : eq(mailOutbox.ownerId, me);
      const where = statuses
        ? and(scope, inArray(mailOutbox.status, statuses))
        : scope;
      const counts: NotificationCounts = {
        all: 0,
        pending: 0,
        sent: 0,
        failed: 0,
      };
      for (const r of db
        .select({ status: mailOutbox.status, n: count() })
        .from(mailOutbox)
        .where(scope)
        .groupBy(mailOutbox.status)
        .all()) {
        counts[r.status] = r.n;
        counts.all += r.n;
      }
      const total = statuses
        ? statuses.reduce((sum, s) => sum + counts[s], 0)
        : counts.all;
      const rows = db
        .select()
        .from(mailOutbox)
        .where(where)
        .orderBy(desc(mailOutbox.createdAt), desc(mailOutbox.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .all();
      const byId = new Map(
        db
          .select({
            id: streamers.userId,
            login: streamers.login,
            displayName: streamers.displayName,
          })
          .from(streamers)
          .all()
          .map((s) => [s.id, s]),
      );
      const names = admin
        ? new Map(
            db
              .select({ id: users.id, username: users.username })
              .from(users)
              .all()
              .map((u) => [u.id, u.username]),
          )
        : undefined;
      const body: NotificationPage = {
        items: rows.map((r) =>
          toNotification(
            r,
            byId,
            names ? (names.get(r.ownerId) ?? null) : null,
          ),
        ),
        page,
        pageSize,
        total,
        counts,
      };
      return c.json(body);
    })
    .post('/notifications/retry-failed', (c) => {
      const { id: me, role } = c.get('user');
      const requeued = db.transaction((tx) => {
        const ids = tx
          .select({ id: mailOutbox.id })
          .from(mailOutbox)
          .where(
            and(
              eq(mailOutbox.status, 'failed'),
              role === 'admin' ? undefined : eq(mailOutbox.ownerId, me),
            ),
          )
          .all();
        // outbox.retry writes through the same better-sqlite3 connection as tx (app.ts wiring), so it joins this transaction.
        return ids.filter((r) => deps.outbox.retry(r.id)).length;
      });
      if (requeued > 0) deps.outbox.wake();
      return c.json({ requeued });
    })
    .post('/notifications/:id/retry', (c) => {
      const { id: me, role } = c.get('user');
      const id = Number(c.req.param('id'));
      const visible =
        Number.isInteger(id) &&
        (role === 'admin' ||
          db
            .select({ id: mailOutbox.id })
            .from(mailOutbox)
            .where(and(eq(mailOutbox.id, id), eq(mailOutbox.ownerId, me)))
            .get() !== undefined);
      if (!visible || !deps.outbox.retry(id)) {
        return c.json(
          apiError('not_found', 'No failed notification with this id'),
          404,
        );
      }
      deps.outbox.wake();
      const row = db
        .select()
        .from(mailOutbox)
        .where(eq(mailOutbox.id, id))
        .get();
      return c.json({ ok: true as const, status: row?.status ?? 'pending' });
    })
    .post('/test-mail', async (c) => {
      const me = c.get('user').id;
      const res = await sendTestMail({
        db,
        ownerId: me,
        mailer: deps.mailer,
        adminUrl: deps.adminUrl,
      });
      if (!res.ok) {
        const noRecipients = getRecipients(db, me).length === 0;
        return noRecipients
          ? c.json(apiError('no_recipients', 'No recipients configured'), 400)
          : c.json(apiError('mail_failed', res.error ?? 'Mail failed'), 502);
      }
      return c.json({ ok: true as const });
    })
    .get('/timeline', zv('query', timelineQuery), (c) =>
      c.json(
        queryTimeline(
          db,
          { ...c.req.valid('query'), ownerId: c.get('user').id },
          clock.now(),
        ),
      ),
    )
    .get('/timeline/categories', (c) =>
      c.json(queryRecordedCategories(db, c.get('user').id)),
    )
    .get('/timeline/streams/:streamId', (c) => {
      const body = queryStream(
        db,
        c.get('user').id,
        c.req.param('streamId'),
        clock.now(),
      );
      if (!body) return c.json(apiError('not_found', 'Unknown stream'), 404);
      return c.json(body);
    });

  const authDeps = {
    ...deps,
    rateLimiter: deps.rateLimiter ?? createLoginRateLimiter(clock),
  };
  return new Hono()
    .use('/api/*', originCheck())
    .route('/api/auth', createAuthRoutes(authDeps))
    .route('/api/account', createAccountRoutes(authDeps))
    .route('/api', api);
}

export type AppType = ReturnType<typeof createAdminRoutes>;

// ---------- SPA ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

async function serveFile(c: Context, file: string, cacheControl: string) {
  const body = await readFile(file);
  return c.body(body, 200, {
    'Content-Type':
      MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': cacheControl,
  });
}

/** Admin listener app: typed API, SPA delivery and security headers. */
export function createAdminApp(deps: AdminAppDeps) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    await next();
    c.res.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'same-origin');
  });

  app.onError((err, c) => {
    if (err instanceof TwitchUnavailable) {
      deps.logger.warn('twitch unavailable', { error: err.message });
      return c.json(
        apiError('twitch_unavailable', 'Twitch is unavailable'),
        502,
      );
    }
    if (err instanceof UnknownCategory) {
      return c.json(apiError('unknown_category', err.message), 400);
    }
    deps.logger.error('admin request failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json(apiError('internal', 'Internal error'), 500);
  });

  app.route('/', createAdminRoutes(deps));

  app.all('/api/*', (c) => c.json(apiError('not_found', 'Not found'), 404));

  const root = deps.webDist ? resolve(deps.webDist) : undefined;
  if (root && existsSync(root) && statSync(root).isDirectory()) {
    const index = join(root, 'index.html');
    app.get('*', async (c) => {
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(c.req.url).pathname);
      } catch {
        pathname = '/';
      }
      const file = resolve(root, `.${pathname}`);
      if (file.startsWith(root + sep) && isFile(file)) {
        const immutable = pathname.startsWith('/assets/');
        return serveFile(
          c,
          file,
          immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      }
      if (pathname.startsWith('/assets/') || !isFile(index)) {
        return c.text('Not found', 404);
      }
      return serveFile(c, index, 'no-cache');
    });
  }

  app.notFound((c) => c.json(apiError('not_found', 'Not found'), 404));
  return app;
}
