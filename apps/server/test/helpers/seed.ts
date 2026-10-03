import { eq } from 'drizzle-orm';
import type { Db } from '../../src/db/client.ts';
import {
  categories,
  follows,
  type GameMode,
  gameGroupCategories,
  gameGroups,
  streamerGames,
  streamers,
  users,
} from '../../src/db/schema.ts';

export const OWNER_ID = 1;

/** Adds a second account and returns its id. */
export function seedUser(db: Db, username: string): number {
  return db.insert(users).values({ username }).returning({ id: users.id }).get()
    .id;
}

export const JUST_CHATTING = { id: '509658', name: 'Just Chatting' };
export const ELDEN_RING = { id: '512953', name: 'Elden Ring' };
export const MINECRAFT = { id: '27471', name: 'Minecraft' };

export function seedCategory(
  db: Db,
  c: { id: string; name: string },
  boxArtUrl: string | null = null,
): void {
  db.insert(categories)
    .values({ categoryId: c.id, name: c.name, boxArtUrl })
    .onConflictDoNothing()
    .run();
}

export function seedStreamer(
  db: Db,
  opts: {
    id: string;
    login?: string;
    displayName?: string;
    mode?: GameMode;
    enabled?: boolean;
    ownerId?: number;
    games?: { id: string; name: string }[];
  },
): void {
  const login = opts.login ?? `user${opts.id}`;
  const ownerId = opts.ownerId ?? OWNER_ID;
  db.insert(streamers)
    .values({
      userId: opts.id,
      login,
      displayName: opts.displayName ?? login,
      createdAt: 0,
    })
    .onConflictDoNothing()
    .run();
  db.insert(follows)
    .values({
      ownerId,
      broadcasterId: opts.id,
      gameMode: opts.mode ?? 'default',
      enabled: opts.enabled ?? true,
    })
    .run();
  for (const g of opts.games ?? []) {
    seedCategory(db, g);
    db.insert(streamerGames)
      .values({ ownerId, userId: opts.id, categoryId: g.id })
      .run();
  }
}

export function seedDefaultGames(
  db: Db,
  games: { id: string; name: string }[],
): void {
  const group = db
    .select({ id: gameGroups.id })
    .from(gameGroups)
    .where(eq(gameGroups.isDefault, true))
    .get();
  if (!group) throw new Error('default game group missing');
  for (const g of games) {
    seedCategory(db, g);
    db.insert(gameGroupCategories)
      .values({ groupId: group.id, categoryId: g.id })
      .run();
  }
}
