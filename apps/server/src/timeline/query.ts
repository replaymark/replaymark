import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  max,
  sql,
} from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import {
  categories,
  categorySegments,
  follows,
  streamers,
  streams,
} from '../db/schema.ts';
import { getRecordingSince } from '../db/settings.ts';
import {
  type RecordedCategory,
  type StreamDetail,
  TIMELINE_PAGE_SIZE,
  type TimelinePage,
  type TimelineSegment,
  type TimelineStream,
} from '../shared/schemas.ts';
import type { MutedSegment } from '../twitch/helix.ts';
import { deepLink, isMuted, type VodRef, vodState } from './vod.ts';

/** Box-art template built from the category id when `categories` has none. */
export function fallbackBoxArt(categoryId: string): string {
  return `https://static-cdn.jtvnw.net/ttv-boxart/${categoryId}_IGDB-{width}x{height}.jpg`;
}

/** Broadcasters the account follows; the timeline never shows anything else. */
function followedBy(ownerId: number) {
  return sql`select ${follows.broadcasterId} from ${follows} where ${follows.ownerId} = ${ownerId}`;
}

export interface TimelineFilter {
  /** Account whose followed broadcasters are shown. */
  ownerId: number;
  /** Absent: every recorded stream, no segment flagged `match`. */
  categoryId?: string | undefined;
  streamerIds: string[];
  /** Epoch ms, inclusive. */
  from?: number;
  /** Epoch ms, inclusive. */
  to?: number;
  page: number;
}

type StreamRow = typeof streams.$inferSelect;
type SegmentRow = typeof categorySegments.$inferSelect;

/**
 * The stored duration may be stale (VOD matched while live); clamp against the
 * archive's minimum length, known from the stream end (or now) instead.
 */
function vodOf(s: StreamRow, now: number): VodRef | null {
  if (!s.vodId || s.vodCreatedAt == null) return null;
  const elapsedS = Math.floor(((s.endedAt ?? now) - s.vodCreatedAt) / 1000);
  return {
    id: s.vodId,
    createdAt: s.vodCreatedAt,
    durationSeconds: Math.max(s.vodDurationS ?? 0, elapsedS),
  };
}

function mutedOf(s: StreamRow): MutedSegment[] {
  if (!s.vodMuted) return [];
  try {
    const v = JSON.parse(s.vodMuted) as unknown;
    return Array.isArray(v) ? (v as MutedSegment[]) : [];
  } catch {
    return [];
  }
}

function toStreams(
  db: Db,
  rows: StreamRow[],
  segs: SegmentRow[],
  now: number,
  matchId?: string,
): TimelineStream[] {
  if (rows.length === 0) return [];
  const bIds = [...new Set(rows.map((r) => r.broadcasterId))];
  const people = new Map(
    db
      .select()
      .from(streamers)
      .where(inArray(streamers.userId, bIds))
      .all()
      .map((p) => [p.userId, p]),
  );
  const cIds = [...new Set(segs.map((s) => s.categoryId))];
  const cats = new Map(
    cIds.length === 0
      ? []
      : db
          .select()
          .from(categories)
          .where(inArray(categories.categoryId, cIds))
          .all()
          .map((c) => [c.categoryId, c]),
  );
  return rows.map((s) => {
    const p = people.get(s.broadcasterId);
    const vod = vodOf(s, now);
    const muted = mutedOf(s);
    const segments: TimelineSegment[] = segs
      .filter((g) => g.streamId === s.streamId)
      .map((g) => {
        const end = g.endedAt ?? Math.max(now, g.startedAt);
        const c = cats.get(g.categoryId);
        return {
          categoryId: g.categoryId,
          categoryName: c?.name ?? g.categoryName ?? '',
          boxArtUrl: c?.boxArtUrl || fallbackBoxArt(g.categoryId),
          startedAt: g.startedAt,
          endedAt: g.endedAt,
          durationMs: end - g.startedAt,
          startApprox: g.startApprox,
          endApprox: g.endApprox,
          muted: vod ? isMuted(vod, muted, g.startedAt, end) : false,
          link: vod ? deepLink(vod, g.startedAt, g.startApprox) : null,
          match: matchId !== undefined && g.categoryId === matchId,
        };
      });
    return {
      streamId: s.streamId,
      broadcaster: {
        id: s.broadcasterId,
        login: p?.login ?? null,
        displayName: p?.displayName ?? null,
        avatarUrl: p?.avatarUrl ?? null,
      },
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      endApprox: s.endApprox,
      live: s.endedAt == null,
      vodState: vodState(s.vodState, s.endedAt, now),
      vodUrl: vod ? `https://www.twitch.tv/videos/${vod.id}` : null,
      segments,
    };
  });
}

/**
 * Recorded streams, newest first, each with all its segments. With a category,
 * only streams that played it, and its segments are flagged `match`.
 */
export function queryTimeline(
  db: Db,
  f: TimelineFilter,
  now: number,
): TimelinePage {
  const conds = [sql`${streams.broadcasterId} in (${followedBy(f.ownerId)})`];
  if (f.categoryId !== undefined)
    conds.push(
      sql`exists (select 1 from ${categorySegments} where ${categorySegments.streamId} = ${streams.streamId} and ${categorySegments.categoryId} = ${f.categoryId})`,
    );
  if (f.streamerIds.length > 0)
    conds.push(inArray(streams.broadcasterId, f.streamerIds));
  if (f.from !== undefined) conds.push(gte(streams.startedAt, f.from));
  if (f.to !== undefined) conds.push(lte(streams.startedAt, f.to));
  const rows = db
    .select()
    .from(streams)
    .where(and(...conds))
    .orderBy(desc(streams.startedAt), desc(streams.streamId))
    .limit(TIMELINE_PAGE_SIZE + 1)
    .offset((f.page - 1) * TIMELINE_PAGE_SIZE)
    .all();
  const hasMore = rows.length > TIMELINE_PAGE_SIZE;
  const pageRows = rows.slice(0, TIMELINE_PAGE_SIZE);
  const segs =
    pageRows.length === 0
      ? []
      : db
          .select()
          .from(categorySegments)
          .where(
            inArray(
              categorySegments.streamId,
              pageRows.map((r) => r.streamId),
            ),
          )
          .orderBy(asc(categorySegments.startedAt), asc(categorySegments.id))
          .all();
  return {
    items: toStreams(db, pageRows, segs, now, f.categoryId),
    page: f.page,
    pageSize: TIMELINE_PAGE_SIZE,
    hasMore,
    recordingSince: getRecordingSince(db) ?? now,
  };
}

/** One stream with all of its segments in order; null when unknown. */
export function queryStream(
  db: Db,
  ownerId: number,
  streamId: string,
  now: number,
): StreamDetail | null {
  const row = db
    .select()
    .from(streams)
    .where(
      and(
        eq(streams.streamId, streamId),
        sql`${streams.broadcasterId} in (${followedBy(ownerId)})`,
      ),
    )
    .get();
  if (!row) return null;
  const segs = db
    .select()
    .from(categorySegments)
    .where(eq(categorySegments.streamId, streamId))
    .orderBy(asc(categorySegments.startedAt), asc(categorySegments.id))
    .all();
  return toStreams(db, [row], segs, now)[0] ?? null;
}

/** Categories present in the recorded segments, most recently played first. */
export function queryRecordedCategories(
  db: Db,
  ownerId: number,
): RecordedCategory[] {
  const lastPlayed = max(categorySegments.startedAt);
  return db
    .select({
      id: categorySegments.categoryId,
      catName: categories.name,
      segName: sql<
        string | null
      >`(select latest.category_name from ${categorySegments} as latest where latest.category_id = ${categorySegments.categoryId} and latest.category_name is not null order by latest.started_at desc, latest.id desc limit 1)`,
      boxArtUrl: categories.boxArtUrl,
      streamCount: count(sql`distinct ${categorySegments.streamId}`),
      lastPlayedAt: lastPlayed,
    })
    .from(categorySegments)
    .leftJoin(
      categories,
      eq(categories.categoryId, categorySegments.categoryId),
    )
    .where(sql`${categorySegments.broadcasterId} in (${followedBy(ownerId)})`)
    .groupBy(categorySegments.categoryId)
    .orderBy(desc(lastPlayed), asc(categorySegments.categoryId))
    .all()
    .map((r) => ({
      id: r.id,
      name: r.catName ?? r.segName ?? '',
      boxArtUrl: r.boxArtUrl || fallbackBoxArt(r.id),
      streamCount: r.streamCount,
      lastPlayedAt: r.lastPlayedAt ?? 0,
    }));
}
