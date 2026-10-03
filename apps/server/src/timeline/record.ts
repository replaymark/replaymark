import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { categorySegments, type liveState, streams } from '../db/schema.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type RecorderDb = Db | Tx;

type LiveStateRow = typeof liveState.$inferSelect;
export type TimelineState = Pick<
  LiveStateRow,
  'broadcasterId' | 'streamId' | 'categoryId' | 'categoryName' | 'startedAt'
>;

/**
 * Diffs two live-state rows and writes stream and category-segment records (design D2/D3).
 * `at` is the event receive time (or `started_at` for stream.online); `approx` marks
 * boundaries observed by the live sync. Returns the ids of every stream it wrote to, so a
 * caller can publish a timeline event for each.
 */
export function recordTransition(
  db: RecorderDb,
  prev: TimelineState | null | undefined,
  next: TimelineState,
  at: number,
  approx: boolean,
  /** The transition carries a freshly observed category (not a leftover in live_state). */
  categoryConfirmed: boolean,
  /** The category was fetched right after stream.online: its segment may start at the stream start. */
  streamStart = false,
): string[] {
  const { broadcasterId } = next;
  const touched = new Set<string>();

  // Close every open stream of this broadcaster other than the current one
  // (stream.offline, a new stream id, or leftovers).
  const stale = db
    .select()
    .from(streams)
    .where(
      and(
        eq(streams.broadcasterId, broadcasterId),
        isNull(streams.endedAt),
        next.streamId ? ne(streams.streamId, next.streamId) : undefined,
      ),
    )
    .all();
  for (const s of stale) {
    // Closed because a different stream went live: the offline was missed, so the
    // end is only an upper bound.
    const endApprox = approx || next.streamId != null;
    const seg = openSegment(db, s.streamId);
    let end = Math.max(at, s.startedAt);
    if (seg) {
      end = Math.max(end, seg.startedAt);
      closeSegment(db, seg.id, end, endApprox);
    }
    db.update(streams)
      .set({ endedAt: end, endApprox })
      .where(eq(streams.streamId, s.streamId))
      .run();
    touched.add(s.streamId);
  }
  const result = () => [...touched];
  if (!next.streamId) return result();

  const newStream = prev?.streamId !== next.streamId;
  const startedAt = next.startedAt ?? at;
  let stream = db
    .select()
    .from(streams)
    .where(eq(streams.streamId, next.streamId))
    .get();
  // Stream row missing although live_state already knew this stream id: the stream
  // began before recording existed (deployment). Record it, but never backdate a segment.
  const adopted = !stream && !newStream;
  if (!stream) {
    db.insert(streams)
      .values({ streamId: next.streamId, broadcasterId, startedAt })
      .onConflictDoNothing()
      .run();
    stream = db
      .select()
      .from(streams)
      .where(eq(streams.streamId, next.streamId))
      .get();
    touched.add(next.streamId);
  }
  if (!stream) return result();
  // Reported live again after being closed (streamer paused/deleted mid-stream):
  // reopen it; the gap is unknown, so the next segment start is approximate.
  const reopened = stream.endedAt != null;
  if (reopened) {
    db.update(streams)
      .set({ endedAt: null, endApprox: false })
      .where(eq(streams.streamId, stream.streamId))
      .run();
    touched.add(stream.streamId);
  }

  const seg = openSegment(db, stream.streamId);
  // A category not part of this transition may be stale (left over from the
  // previous stream, e.g. on stream.online); wait for a confirmed one.
  if (!categoryConfirmed) return result();
  if (seg && seg.categoryId === next.categoryId) return result();
  // Out-of-order guard: never end a segment before it started.
  if (seg && at < seg.startedAt) return result();

  let start = at;
  if (!seg && streamStart && !approx && !adopted && !reopened) {
    const any = db
      .select({ id: categorySegments.id })
      .from(categorySegments)
      .where(eq(categorySegments.streamId, stream.streamId))
      .get();
    if (!any) start = stream.startedAt;
  }
  if (seg) {
    closeSegment(db, seg.id, at, approx);
    touched.add(stream.streamId);
  }
  if (next.categoryId) {
    db.insert(categorySegments)
      .values({
        streamId: stream.streamId,
        broadcasterId,
        categoryId: next.categoryId,
        categoryName: next.categoryName,
        startedAt: start,
        startApprox: approx || adopted || reopened,
      })
      .run();
    touched.add(stream.streamId);
  }
  return result();
}

function openSegment(db: RecorderDb, streamId: string) {
  return db
    .select()
    .from(categorySegments)
    .where(
      and(
        eq(categorySegments.streamId, streamId),
        isNull(categorySegments.endedAt),
      ),
    )
    .orderBy(desc(categorySegments.startedAt), asc(categorySegments.id))
    .get();
}

function closeSegment(db: RecorderDb, id: number, at: number, approx: boolean) {
  db.update(categorySegments)
    .set({ endedAt: at, endApprox: approx })
    .where(eq(categorySegments.id, id))
    .run();
}
