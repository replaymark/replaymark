import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import {
  categories,
  follows,
  type GameMode,
  gameGroupCategories,
  gameGroups,
  sessions,
  streamerGames,
  streamerGroups,
  streamers,
  subscriptions,
  users,
} from '../db/schema.ts';
import { firstAdminId, getMeta } from '../db/settings.ts';
import type { Logger } from '../log.ts';
import { type Mailer, sendTestMail } from '../mail/mailer.ts';
import { apiError } from '../shared/errors.ts';
import type { SyncResult } from '../shared/events.ts';
import type { Helix } from '../twitch/helix.ts';
import { listStreamers, syncDto, upsertCategories } from './admin.ts';
import { generateTemporaryPassword, hashPassword } from './auth.ts';

export interface InternalAppDeps {
  db: Db;
  clock: Clock;
  logger: Logger;
  helix: Pick<Helix, 'getUsersByLogin' | 'getGames' | 'searchCategories'>;
  reconciler: { request(reason: string): Promise<void> };
  mailer: Mailer;
  /** PUBLIC_BASE_URL for the test mail's admin UI link. */
  adminUrl?: string;
}

export const importInput = z.object({
  defaultGames: z.array(z.string().min(1)).default([]),
  streamers: z
    .array(
      z.object({
        login: z.string().min(1),
        games: z.union([z.array(z.string().min(1)), z.literal('*'), z.null()]),
      }),
    )
    .default([]),
});
export type ImportInput = z.input<typeof importInput>;

export interface ImportReport {
  imported: string[];
  unknownLogins: string[];
  unknownGames: string[];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Internal app (127.0.0.1:8082): health check and CLI endpoints, no auth. */
export function createInternalApp(deps: InternalAppDeps) {
  const { db, clock, logger, helix, reconciler } = deps;

  /** Resolves game names case-insensitively: local cache, then Helix by name, then search. */
  async function resolveGames(
    names: readonly string[],
  ): Promise<Map<string, string>> {
    const byLower = new Map<string, string>();
    const wanted = [...new Set(names.map((n) => n.trim().toLowerCase()))];
    if (wanted.length === 0) return byLower;
    for (const row of db.select().from(categories).all()) {
      const key = row.name.toLowerCase();
      if (wanted.includes(key) && !byLower.has(key))
        byLower.set(key, row.categoryId);
    }
    const missing = () => wanted.filter((n) => !byLower.has(n));
    const original = new Map(names.map((n) => [n.trim().toLowerCase(), n]));
    if (missing().length > 0) {
      const found = await helix.getGames({
        names: missing().map((n) => original.get(n) ?? n),
      });
      upsertCategories(db, found);
      for (const g of found) {
        const key = g.name.toLowerCase();
        if (!byLower.has(key)) byLower.set(key, g.id);
      }
    }
    for (const name of missing()) {
      const hits = await helix.searchCategories(original.get(name) ?? name);
      const hit = hits.find((h) => h.name.toLowerCase() === name);
      if (hit) {
        upsertCategories(db, [hit]);
        byLower.set(name, hit.id);
      }
    }
    return byLower;
  }

  async function runImport(input: z.output<typeof importInput>) {
    const adminId = firstAdminId(db);
    const logins = [
      ...new Set(input.streamers.map((s) => s.login.trim().toLowerCase())),
    ];
    const users = logins.length > 0 ? await helix.getUsersByLogin(logins) : [];
    const userByLogin = new Map(users.map((u) => [u.login.toLowerCase(), u]));

    const allGames = [
      ...input.defaultGames,
      ...input.streamers.flatMap((s) =>
        Array.isArray(s.games) ? s.games : [],
      ),
    ];
    const games = await resolveGames(allGames);
    const unknownGames = [
      ...new Set(allGames.filter((g) => !games.has(g.trim().toLowerCase()))),
    ];
    const idsOf = (names: readonly string[]) => [
      ...new Set(
        names
          .map((n) => games.get(n.trim().toLowerCase()))
          .filter((id): id is string => !!id),
      ),
    ];

    const imported: string[] = [];
    const unknownLogins: string[] = [];
    const now = clock.now();
    db.transaction((tx) => {
      const defaultGroup = tx
        .select({ id: gameGroups.id })
        .from(gameGroups)
        .where(
          and(eq(gameGroups.ownerId, adminId), eq(gameGroups.isDefault, true)),
        )
        .get();
      if (!defaultGroup) throw new Error('default game group missing');
      for (const id of idsOf(input.defaultGames)) {
        tx.insert(gameGroupCategories)
          .values({ groupId: defaultGroup.id, categoryId: id })
          .onConflictDoNothing()
          .run();
      }
      for (const entry of input.streamers) {
        const user = userByLogin.get(entry.login.trim().toLowerCase());
        if (!user) {
          if (!unknownLogins.includes(entry.login))
            unknownLogins.push(entry.login);
          continue;
        }
        const gameMode: GameMode =
          entry.games === null
            ? 'default'
            : entry.games === '*'
              ? 'any'
              : 'custom';
        const info = {
          login: user.login,
          displayName: user.displayName,
          avatarUrl: user.profileImageUrl || null,
        };
        tx.insert(streamers)
          .values({ userId: user.id, ...info, createdAt: now })
          .onConflictDoUpdate({ target: streamers.userId, set: info })
          .run();
        tx.insert(follows)
          .values({
            ownerId: adminId,
            broadcasterId: user.id,
            gameMode,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: [follows.ownerId, follows.broadcasterId],
            set: { gameMode },
          })
          .run();
        tx.delete(streamerGames)
          .where(
            and(
              eq(streamerGames.ownerId, adminId),
              eq(streamerGames.userId, user.id),
            ),
          )
          .run();
        tx.delete(streamerGroups)
          .where(
            and(
              eq(streamerGroups.ownerId, adminId),
              eq(streamerGroups.userId, user.id),
            ),
          )
          .run();
        if (Array.isArray(entry.games)) {
          const ids = idsOf(entry.games);
          if (ids.length > 0)
            tx.insert(streamerGames)
              .values(
                ids.map((categoryId) => ({
                  ownerId: adminId,
                  userId: user.id,
                  categoryId,
                })),
              )
              .run();
        }
        if (!imported.includes(user.login)) imported.push(user.login);
      }
    });
    return { imported, unknownLogins, unknownGames } satisfies ImportReport;
  }

  return new Hono()
    .get('/healthz', (c) => {
      try {
        db.get(sql`SELECT 1`);
        const enabled = db
          .select({ n: sql<number>`count(*)` })
          .from(subscriptions)
          .where(eq(subscriptions.status, 'enabled'))
          .get();
        const last = getMeta<SyncResult>(db, 'last_sync');
        return c.json(
          {
            status: 'ok' as const,
            subscriptionsEnabled: enabled?.n ?? 0,
            lastSyncAt: last ? new Date(last.at).toISOString() : null,
            lastSyncOk: last ? last.ok : null,
          },
          200,
        );
      } catch (err) {
        logger.error('health check failed', { error: errText(err) });
        return c.json({ status: 'error' as const }, 503);
      }
    })
    .get('/internal/status', (c) =>
      c.json(
        listStreamers(db, firstAdminId(db)).map((s) => ({
          id: s.id,
          login: s.login,
          displayName: s.displayName,
          enabled: s.enabled,
          live: s.live,
          currentGame: s.currentCategory?.name ?? null,
          subscriptions: s.subscriptions,
        })),
      ),
    )
    .post('/internal/sync', async (c) => {
      await reconciler.request('cli');
      return c.json(syncDto(getMeta<SyncResult>(db, 'last_sync')));
    })
    .post('/internal/test-mail', async (c) => {
      const res = await sendTestMail({
        ownerId: firstAdminId(db),
        db,
        mailer: deps.mailer,
        adminUrl: deps.adminUrl,
      });
      return res.ok
        ? c.json({ ok: true as const })
        : c.json(apiError('mail_failed', res.error ?? 'Mail failed'), 502);
    })
    .post('/internal/users/reset-password', async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        raw = undefined;
      }
      const parsed = z.object({ username: z.string().min(1) }).safeParse(raw);
      if (!parsed.success) {
        return c.json(apiError('validation_failed', 'Username required'), 400);
      }
      const target = db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(
          sql`lower(${users.username}) = lower(${parsed.data.username.trim()})`,
        )
        .get();
      if (!target) return c.json(apiError('not_found', 'Unknown user'), 404);
      const temporaryPassword = generateTemporaryPassword();
      db.transaction((tx) => {
        tx.update(users)
          .set({
            passwordHash: hashPassword(temporaryPassword),
            mustChangePassword: true,
          })
          .where(eq(users.id, target.id))
          .run();
        tx.delete(sessions).where(eq(sessions.userId, target.id)).run();
      });
      return c.json({ username: target.username, temporaryPassword });
    })
    .post('/internal/import', async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        raw = undefined;
      }
      const parsed = importInput.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          apiError('validation_failed', 'Invalid import body'),
          400,
        );
      }
      let report: ImportReport;
      try {
        report = await runImport(parsed.data);
      } catch (err) {
        logger.warn('import failed', { error: errText(err) });
        return c.json(
          apiError('twitch_unavailable', 'Twitch is unavailable'),
          502,
        );
      }
      logger.info('import done', { ...report });
      await reconciler.request('import');
      return c.json(report);
    });
}
