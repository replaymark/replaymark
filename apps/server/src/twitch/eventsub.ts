import { eq } from 'drizzle-orm';
import { liveState, streamers } from '../db/schema.ts';
import type { Bus } from '../events/bus.ts';
import { maybeNotify, type NotifyDeps } from '../notify/check.ts';
import { recordTransition } from '../timeline/record.ts';
import type { Helix } from './helix.ts';

export interface LiveStateDeps extends NotifyDeps {
  bus: Bus;
}

export interface EventsubDeps extends LiveStateDeps {
  helix: Pick<Helix, 'getChannels'>;
}

type LiveStateRow = typeof liveState.$inferSelect;
export type LiveStatePatch = Partial<
  Pick<
    LiveStateRow,
    'streamId' | 'categoryId' | 'categoryName' | 'title' | 'startedAt'
  >
>;

/** Malformed events that no retry can fix; the inbox marks them failed at once. */
export class PermanentEventError extends Error {}

/** How long live sync defers to an EventSub-derived live_state (Helix lags behind events). */
export const EVENT_GRACE_MS = 5 * 60_000;

const FIELDS = [
  'streamId',
  'categoryId',
  'categoryName',
  'title',
  'startedAt',
] as const;

export interface TransitionTime {
  /** Event time for the timeline (receive time or `started_at`); defaults to now. */
  at?: number;
  /** Boundary observed by the live sync rather than an event. */
  approx?: boolean;
  /** Category fetched right after stream.online: its segment starts at the stream start. */
  streamStart?: boolean;
}

/**
 * Upserts live_state and records the timeline transition in one transaction;
 * publishes `live-state` when anything changed. Returns the new row.
 */
export function updateLiveState(
  deps: LiveStateDeps,
  broadcasterId: string,
  patch: LiveStatePatch,
  source: 'event' | 'sync' = 'sync',
  time: TransitionTime = {},
): LiveStateRow {
  const { next, changed, recorded } = deps.db.transaction((tx) => {
    const prev = tx
      .select()
      .from(liveState)
      .where(eq(liveState.broadcasterId, broadcasterId))
      .get();
    const base: LiveStateRow = prev ?? {
      broadcasterId,
      streamId: null,
      categoryId: null,
      categoryName: null,
      title: null,
      startedAt: null,
      updatedAt: 0,
      eventAt: null,
    };
    const next: LiveStateRow = { ...base };
    for (const key of FIELDS) {
      const v = patch[key];
      if (v !== undefined) (next as Record<string, unknown>)[key] = v;
    }
    const changed = !prev || FIELDS.some((k) => prev[k] !== next[k]);
    if (source === 'event') next.eventAt = deps.clock.now();
    if (changed) {
      next.updatedAt = deps.clock.now();
      const { broadcasterId: _id, ...set } = next;
      tx.insert(liveState)
        .values(next)
        .onConflictDoUpdate({ target: liveState.broadcasterId, set })
        .run();
    } else if (source === 'event')
      tx.update(liveState)
        .set({ eventAt: next.eventAt })
        .where(eq(liveState.broadcasterId, broadcasterId))
        .run();
    // Unchanged transitions still run the recorder when they confirm a category:
    // the fetched category may equal a stale one already in live_state.
    const recorded =
      changed || patch.categoryId !== undefined
        ? recordTransition(
            tx,
            prev,
            next,
            time.at ?? deps.clock.now(),
            time.approx ?? false,
            patch.categoryId !== undefined,
            time.streamStart ?? false,
          )
        : [];
    return { next, changed, recorded };
  });
  // Every stream the recorder closed, opened or changed gets a timeline event.
  for (const streamId of recorded) deps.bus.publish('timeline', { streamId });
  if (!changed) return next;
  deps.bus.publish('live-state', {
    broadcasterId,
    live: next.streamId != null,
    streamId: next.streamId,
    categoryId: next.categoryId,
    categoryName: next.categoryName,
    title: next.title,
    startedAt: next.startedAt,
  });
  return next;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined;

function parseTime(v: unknown): number | null {
  const t = typeof v === 'string' ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : null;
}

/** Applies one EventSub notification event to live_state and triggers notification checks. */
export async function applyEvent(
  deps: EventsubDeps,
  subscriptionType: string,
  event: Record<string, unknown>,
  /** When the event was received from Twitch (inbox `receivedAt`); defaults to now. */
  receivedAt: number = deps.clock.now(),
): Promise<void> {
  const time: TransitionTime = { at: receivedAt };
  const broadcasterId = str(event.broadcaster_user_id);
  if (!broadcasterId)
    throw new PermanentEventError('event without broadcaster_user_id');
  const known = deps.db
    .select({ id: streamers.userId })
    .from(streamers)
    .where(eq(streamers.userId, broadcasterId))
    .get();
  if (!known) return;
  switch (subscriptionType) {
    case 'stream.online': {
      const streamId = str(event.id);
      if (!streamId) throw new PermanentEventError('stream.online without id');
      const startedAt = parseTime(event.started_at);
      updateLiveState(deps, broadcasterId, { streamId, startedAt }, 'event', {
        at: startedAt ?? receivedAt,
      });
      const [channel] = await deps.helix.getChannels([broadcasterId]);
      if (channel)
        updateLiveState(
          deps,
          broadcasterId,
          {
            categoryId: channel.gameId || null,
            categoryName: channel.gameName || null,
            title: channel.title,
          },
          'event',
          { ...time, streamStart: true },
        );
      maybeNotify(deps, broadcasterId);
      return;
    }
    case 'channel.update': {
      const row = updateLiveState(
        deps,
        broadcasterId,
        {
          categoryId: str(event.category_id) || null,
          categoryName: str(event.category_name) || null,
          title: str(event.title) ?? null,
        },
        'event',
        time,
      );
      if (row.streamId) maybeNotify(deps, broadcasterId);
      return;
    }
    case 'stream.offline':
      updateLiveState(deps, broadcasterId, { streamId: null }, 'event', time);
      return;
    default:
      throw new PermanentEventError(
        `unsupported subscription type ${subscriptionType}`,
      );
  }
}
