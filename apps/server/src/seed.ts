import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import {
  categories,
  categorySegments,
  follows,
  type GameMode,
  gameGroupCategories,
  gameGroups,
  liveState,
  mailOutbox,
  sentNotifications,
  streamerGames,
  streamerGroups,
  streamers,
  streams,
  userRecipients,
  users,
} from './db/schema.ts';
import { backdateRecordingSince, firstAdminId } from './db/settings.ts';
import { renderNotificationMail } from './mail/render.ts';
import type { OutboxPayload } from './notify/check.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HISTORY_DAYS = 28;
const DEMO_EMAIL = 'admin@example.org';

interface Category {
  id: string;
  name: string;
}

const JUST_CHATTING: Category = { id: '509658', name: 'Just Chatting' };
const ELDEN_RING: Category = { id: '512953', name: 'Elden Ring' };
const MINECRAFT: Category = { id: '27471', name: 'Minecraft' };
const VALORANT: Category = { id: '516575', name: 'VALORANT' };
const LEAGUE: Category = { id: '21779', name: 'League of Legends' };
const FORTNITE: Category = { id: '33214', name: 'Fortnite' };
const COUNTER_STRIKE: Category = { id: '32399', name: 'Counter-Strike' };
const GTA_V: Category = { id: '32982', name: 'Grand Theft Auto V' };

const CATEGORIES = [
  JUST_CHATTING,
  ELDEN_RING,
  MINECRAFT,
  VALORANT,
  LEAGUE,
  FORTNITE,
  COUNTER_STRIKE,
  GTA_V,
];

const DEFAULT_GAMES = [ELDEN_RING, MINECRAFT, VALORANT];

const GROUPS: { name: string; games: Category[] }[] = [
  { name: 'Shooters', games: [VALORANT, COUNTER_STRIKE, FORTNITE] },
  { name: 'Cozy', games: [MINECRAFT, JUST_CHATTING] },
];

interface DemoStreamer {
  login: string;
  displayName: string;
  mode: GameMode;
  enabled: boolean;
  /** Custom-mode games and group names. */
  games?: Category[];
  groups?: string[];
  /** Games this streamer plays on stream. */
  plays: Category[];
  live?: boolean;
}

const STREAMERS: DemoStreamer[] = [
  {
    login: 'demo_lumenfox',
    displayName: 'LumenFox',
    mode: 'default',
    enabled: true,
    plays: [JUST_CHATTING, ELDEN_RING],
    live: true,
  },
  {
    login: 'demo_quietharbor',
    displayName: 'QuietHarbor',
    mode: 'default',
    enabled: true,
    plays: [MINECRAFT, JUST_CHATTING],
  },
  {
    login: 'demo_brightmoss',
    displayName: 'BrightMoss',
    mode: 'any',
    enabled: true,
    plays: [GTA_V, FORTNITE, JUST_CHATTING],
    live: true,
  },
  {
    login: 'demo_copperkite',
    displayName: 'CopperKite',
    mode: 'custom',
    enabled: true,
    games: [VALORANT, LEAGUE],
    plays: [VALORANT, LEAGUE, JUST_CHATTING],
  },
  {
    login: 'demo_nimbusowl',
    displayName: 'NimbusOwl',
    mode: 'custom',
    enabled: true,
    groups: ['Shooters'],
    plays: [COUNTER_STRIKE, VALORANT, FORTNITE],
  },
  {
    login: 'demo_velvetrook',
    displayName: 'VelvetRook',
    mode: 'custom',
    enabled: true,
    groups: ['Cozy'],
    games: [ELDEN_RING],
    plays: [MINECRAFT, ELDEN_RING],
  },
  {
    login: 'demo_amberlynx',
    displayName: 'AmberLynx',
    mode: 'any',
    enabled: true,
    plays: [LEAGUE, JUST_CHATTING, GTA_V],
  },
  {
    login: 'demo_saltpine',
    displayName: 'SaltPine',
    mode: 'default',
    enabled: false,
    plays: [ELDEN_RING, MINECRAFT],
  },
  {
    login: 'demo_tidalwren',
    displayName: 'TidalWren',
    mode: 'default',
    enabled: true,
    plays: [VALORANT, JUST_CHATTING],
  },
  {
    login: 'demo_ironbloom',
    displayName: 'IronBloom',
    mode: 'custom',
    enabled: true,
    games: [COUNTER_STRIKE],
    plays: [COUNTER_STRIKE, MINECRAFT],
  },
];

const TITLES = [
  'Late session, come hang out',
  'Trying the new patch',
  'Chill evening stream',
  'Road to the next milestone',
  'Community picks the next game',
  'Practice run, no pressure',
  'Back after a short break',
];

/** Small deterministic PRNG (mulberry32). */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedOptions {
  force?: boolean;
  /** Epoch ms the history ends at; defaults to the current time. */
  now?: number;
  seed?: number;
}

export interface SeedResult {
  adminId: number;
  streamers: number;
  streams: number;
  notifications: number;
}

export class SeedRefusedError extends Error {}

export function isPopulated(db: Db): boolean {
  const streamer = db.select({ id: streamers.userId }).from(streamers).get();
  const follow = db.select({ id: follows.broadcasterId }).from(follows).get();
  return streamer !== undefined || follow !== undefined;
}

function streamerId(index: number): string {
  return String(990_000_001 + index);
}

function ensureGroups(db: Db, ownerId: number, now: number) {
  const ids = new Map<string, number>();
  const defaultGroup = db
    .select({ id: gameGroups.id })
    .from(gameGroups)
    .where(and(eq(gameGroups.ownerId, ownerId), eq(gameGroups.isDefault, true)))
    .get();
  const defaultId =
    defaultGroup?.id ??
    db
      .insert(gameGroups)
      .values({ ownerId, name: 'Default', isDefault: true, createdAt: now })
      .returning({ id: gameGroups.id })
      .get().id;
  const link = (groupId: number, games: Category[]) => {
    for (const g of games) {
      db.insert(gameGroupCategories)
        .values({ groupId, categoryId: g.id })
        .onConflictDoNothing()
        .run();
    }
  };
  link(defaultId, DEFAULT_GAMES);
  for (const group of GROUPS) {
    const existing = db
      .select({ id: gameGroups.id })
      .from(gameGroups)
      .where(
        and(
          eq(gameGroups.ownerId, ownerId),
          sql`lower(${gameGroups.name}) = lower(${group.name})`,
        ),
      )
      .get();
    const id =
      existing?.id ??
      db
        .insert(gameGroups)
        .values({ ownerId, name: group.name, createdAt: now })
        .returning({ id: gameGroups.id })
        .get().id;
    ids.set(group.name, id);
    link(id, group.games);
  }
  return { defaultId, ids };
}

/** Category ids a follow notifies for. */
function watchedCategories(
  s: DemoStreamer,
  groupGames: Map<string, Category[]>,
): Set<string> {
  if (s.mode === 'any') return new Set(CATEGORIES.map((c) => c.id));
  if (s.mode === 'default') return new Set(DEFAULT_GAMES.map((c) => c.id));
  const games = [
    ...(s.games ?? []),
    ...(s.groups ?? []).flatMap((g) => groupGames.get(g) ?? []),
  ];
  return new Set(games.map((c) => c.id));
}

/**
 * Fills a migrated database with fictional streamers, follows and a few
 * weeks of history. Offline: no Twitch calls, no mail. Refuses a database
 * that already has streamers or follows unless `force` is set.
 */
export function seedDemoData(db: Db, opts: SeedOptions = {}): SeedResult {
  if (!opts.force && isPopulated(db)) {
    throw new SeedRefusedError(
      'Database already has streamers or follows; use --force to seed anyway',
    );
  }
  const now = opts.now ?? Date.now();
  const rng = createRng(opts.seed ?? 20_240_601);
  const pick = <T>(xs: readonly T[]): T =>
    xs[Math.floor(rng() * xs.length)] as T;

  return db.transaction((tx) => {
    const t = tx as unknown as Db;
    const adminId = firstAdminId(t);
    const admin = t.select().from(users).where(eq(users.id, adminId)).get();
    if (admin && admin.email === '') {
      t.update(users)
        .set({ email: DEMO_EMAIL })
        .where(eq(users.id, adminId))
        .run();
    }
    const email = admin?.email || DEMO_EMAIL;
    t.insert(userRecipients)
      .values({ userId: adminId, email })
      .onConflictDoNothing()
      .run();

    for (const c of CATEGORIES) {
      t.insert(categories)
        .values({ categoryId: c.id, name: c.name, boxArtUrl: null })
        .onConflictDoNothing()
        .run();
    }
    const groups = ensureGroups(t, adminId, now);
    const groupGames = new Map(GROUPS.map((g) => [g.name, g.games]));

    let streamCount = 0;
    let notificationCount = 0;
    let earliest = now;

    STREAMERS.forEach((s, index) => {
      const id = streamerId(index);
      t.insert(streamers)
        .values({
          userId: id,
          login: s.login,
          displayName: s.displayName,
          avatarUrl: null,
          createdAt: now - HISTORY_DAYS * DAY,
        })
        .onConflictDoNothing()
        .run();
      t.insert(follows)
        .values({
          ownerId: adminId,
          broadcasterId: id,
          gameMode: s.mode,
          enabled: s.enabled,
          createdAt: now - HISTORY_DAYS * DAY,
        })
        .onConflictDoNothing()
        .run();
      for (const g of s.games ?? []) {
        t.insert(streamerGames)
          .values({ ownerId: adminId, userId: id, categoryId: g.id })
          .onConflictDoNothing()
          .run();
      }
      for (const name of s.groups ?? []) {
        const groupId = groups.ids.get(name);
        if (groupId === undefined) continue;
        t.insert(streamerGroups)
          .values({ ownerId: adminId, userId: id, groupId })
          .onConflictDoNothing()
          .run();
      }

      const watched = watchedCategories(s, groupGames);
      for (let day = HISTORY_DAYS; day >= 0; day--) {
        const isToday = day === 0;
        if (isToday ? !s.live : rng() > 0.4) continue;
        const startedAt = isToday
          ? now - 90 * 60_000
          : now - day * DAY + Math.floor((8 + rng() * 10) * HOUR) - 12 * HOUR;
        const durationMs = Math.floor((1.5 + rng() * 4.5) * HOUR);
        const endedAt = isToday ? null : startedAt + durationMs;
        if (endedAt !== null && endedAt > now) continue;
        earliest = Math.min(earliest, startedAt);
        const streamId = `demo-${id}-${day}`;
        const title = pick(TITLES);
        const hasVod = endedAt !== null && rng() < 0.6;
        t.insert(streams)
          .values({
            streamId,
            broadcasterId: id,
            startedAt,
            endedAt,
            endApprox: false,
            vodId: hasVod ? `demo-vod-${id}-${day}` : null,
            vodCreatedAt: hasVod ? startedAt : null,
            vodDurationS: hasVod ? Math.floor(durationMs / 1000) : null,
            vodState:
              endedAt === null ? 'pending' : hasVod ? 'available' : 'none',
          })
          .onConflictDoNothing()
          .run();
        streamCount++;

        const segmentCount = Math.min(
          s.plays.length,
          1 + Math.floor(rng() * 3),
        );
        const slice = durationMs / segmentCount;
        let current: Category = JUST_CHATTING;
        for (let i = 0; i < segmentCount; i++) {
          current = pick(s.plays);
          const segStart = Math.floor(startedAt + i * slice);
          const last = i === segmentCount - 1;
          const segEnd = last
            ? endedAt
            : Math.floor(startedAt + (i + 1) * slice);
          t.insert(categorySegments)
            .values({
              streamId,
              broadcasterId: id,
              categoryId: current.id,
              categoryName: current.name,
              startedAt: segStart,
              endedAt: segEnd,
              startApprox: false,
              endApprox: false,
            })
            .run();
          if (!s.enabled || !watched.has(current.id)) continue;
          const inserted = t
            .insert(sentNotifications)
            .values({
              streamId,
              categoryId: current.id,
              broadcasterId: id,
              ownerId: adminId,
              sentAt: segStart,
            })
            .onConflictDoNothing()
            .run();
          if (inserted.changes === 0) continue;
          const mail = renderNotificationMail({
            lang: admin?.mailLanguage ?? 'en',
            displayName: s.displayName,
            login: s.login,
            gameName: current.name,
            title,
            at: segStart,
            timeZone: 'UTC',
          });
          const payload: OutboxPayload = {
            ...mail,
            recipients: [email],
            login: s.login,
            displayName: s.displayName,
            gameName: current.name,
            boxArtUrl: null,
            title,
          };
          t.insert(mailOutbox)
            .values({
              ownerId: adminId,
              streamId,
              broadcasterId: id,
              categoryId: current.id,
              payload: JSON.stringify(payload),
              attempts: 1,
              nextAttemptAt: segStart,
              status: 'sent',
              createdAt: segStart,
              updatedAt: segStart,
              sentAt: segStart,
            })
            .run();
          notificationCount++;
        }

        if (isToday) {
          t.insert(liveState)
            .values({
              broadcasterId: id,
              streamId,
              categoryId: current.id,
              categoryName: current.name,
              title,
              startedAt,
              updatedAt: now,
              eventAt: now,
            })
            .onConflictDoNothing()
            .run();
        }
      }
    });

    backdateRecordingSince(t, earliest);
    return {
      adminId,
      streamers: STREAMERS.length,
      streams: streamCount,
      notifications: notificationCount,
    };
  });
}
