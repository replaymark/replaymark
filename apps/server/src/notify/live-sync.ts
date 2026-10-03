import { eq, isNotNull } from 'drizzle-orm';
import { follows, liveState } from '../db/schema.ts';
import type { Logger } from '../log.ts';
import {
  EVENT_GRACE_MS,
  type LiveStateDeps,
  updateLiveState,
} from '../twitch/eventsub.ts';
import type { Helix } from '../twitch/helix.ts';
import { maybeNotify } from './check.ts';

export interface LiveSyncDeps extends LiveStateDeps {
  helix: Pick<Helix, 'getStreams'>;
  logger?: Logger;
}

/**
 * Polls Helix for enabled streamers and reconciles live_state (catches missed events).
 * Rows touched by an EventSub event within EVENT_GRACE_MS are left alone because
 * Helix /streams lags behind go-live/offline. Paused or removed streamers are
 * marked offline, as they no longer receive stream.offline.
 */
export function createLiveSync(deps: LiveSyncDeps): () => Promise<void> {
  return async () => {
    const enabled = new Set(
      deps.db
        .selectDistinct({ id: follows.broadcasterId })
        .from(follows)
        .where(eq(follows.enabled, true))
        .all()
        .map((r) => r.id),
    );
    const rows = deps.db
      .select({ id: liveState.broadcasterId })
      .from(liveState)
      .where(isNotNull(liveState.streamId))
      .all();
    const approx = () => ({ at: deps.clock.now(), approx: true });
    for (const r of rows)
      if (!enabled.has(r.id))
        updateLiveState(deps, r.id, { streamId: null }, 'sync', approx());
    const ids = [...enabled];
    if (ids.length === 0) return;
    const streams = await deps.helix.getStreams(ids);
    const live = new Map(streams.map((s) => [s.userId, s]));
    const since = deps.clock.now() - EVENT_GRACE_MS;
    const recent = new Set(
      deps.db
        .select({ id: liveState.broadcasterId, eventAt: liveState.eventAt })
        .from(liveState)
        .all()
        .filter((r) => r.eventAt != null && r.eventAt > since)
        .map((r) => r.id),
    );
    for (const id of ids) {
      if (recent.has(id)) continue;
      const s = live.get(id);
      if (!s) {
        updateLiveState(deps, id, { streamId: null }, 'sync', approx());
        continue;
      }
      const started = Date.parse(s.startedAt);
      updateLiveState(
        deps,
        id,
        {
          streamId: s.id,
          startedAt: Number.isFinite(started) ? started : null,
          categoryId: s.gameId || null,
          categoryName: s.gameName || null,
          title: s.title,
        },
        'sync',
        approx(),
      );
      maybeNotify(deps, id);
    }
  };
}
