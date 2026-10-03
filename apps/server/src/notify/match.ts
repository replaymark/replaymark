import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import {
  follows,
  gameGroupCategories,
  gameGroups,
  streamerGames,
  streamerGroups,
} from '../db/schema.ts';

/** Whether a category change of `broadcasterId` to `categoryId` should notify. */
export function categoryMatches(
  db: Db,
  broadcasterId: string,
  categoryId: string,
  ownerId: number,
): boolean {
  const streamer = db
    .select({ enabled: follows.enabled, mode: follows.gameMode })
    .from(follows)
    .where(
      and(
        eq(follows.ownerId, ownerId),
        eq(follows.broadcasterId, broadcasterId),
      ),
    )
    .get();
  if (!streamer?.enabled || !categoryId) return false;
  if (streamer.mode === 'any') return true;
  if (streamer.mode === 'custom')
    return matchesCustom(db, ownerId, broadcasterId, categoryId);
  return (
    db
      .select({ id: gameGroupCategories.categoryId })
      .from(gameGroupCategories)
      .innerJoin(gameGroups, eq(gameGroups.id, gameGroupCategories.groupId))
      .where(
        and(
          eq(gameGroups.ownerId, ownerId),
          eq(gameGroups.isDefault, true),
          eq(gameGroupCategories.categoryId, categoryId),
        ),
      )
      .get() !== undefined
  );
}

function matchesCustom(
  db: Db,
  ownerId: number,
  broadcasterId: string,
  categoryId: string,
): boolean {
  const single = db
    .select({ id: streamerGames.categoryId })
    .from(streamerGames)
    .where(
      and(
        eq(streamerGames.ownerId, ownerId),
        eq(streamerGames.userId, broadcasterId),
        eq(streamerGames.categoryId, categoryId),
      ),
    );
  const viaGroup = db
    .select({ id: gameGroupCategories.categoryId })
    .from(streamerGroups)
    .innerJoin(
      gameGroupCategories,
      eq(gameGroupCategories.groupId, streamerGroups.groupId),
    )
    .where(
      and(
        eq(streamerGroups.ownerId, ownerId),
        eq(streamerGroups.userId, broadcasterId),
        eq(gameGroupCategories.categoryId, categoryId),
      ),
    );
  return single.union(viaGroup).limit(1).get() !== undefined;
}
