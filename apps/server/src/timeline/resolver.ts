import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import { streams } from '../db/schema.ts';
import type { Bus } from '../events/bus.ts';
import type { Logger } from '../log.ts';
import type { Helix } from '../twitch/helix.ts';

const HOUR = 3_600_000;
export const VOD_RECHECK_MS = HOUR;
export const VOD_GIVE_UP_MS = 7 * 24 * HOUR;
export const VOD_BATCH = 10;

export interface VodResolverDeps {
  db: Db;
  helix: Pick<Helix, 'getVideos'>;
  clock: Clock;
  logger: Logger;
  bus: Bus;
}

export interface VodResolveResult {
  checked: number;
  available: number;
  none: number;
}

/**
 * Resolves pending VODs (design D4): up to 10 due streams, one `getVideos` call per
 * broadcaster, matched by stream id. Never throws; Helix errors are logged.
 * `available` VODs matched while the stream was live are refreshed (duration, muted
 * ranges) under the same hourly gate until one check happened after the stream ended.
 */
export async function resolveVods(
  deps: VodResolverDeps,
): Promise<VodResolveResult> {
  const { db, clock, logger, bus } = deps;
  const result: VodResolveResult = { checked: 0, available: 0, none: 0 };
  const now = clock.now();
  const due = db
    .select()
    .from(streams)
    .where(
      and(
        or(
          eq(streams.vodState, 'pending'),
          and(
            eq(streams.vodState, 'available'),
            or(
              isNull(streams.endedAt),
              isNull(streams.vodCheckedAt),
              lt(streams.vodCheckedAt, streams.endedAt),
            ),
          ),
        ),
        or(
          isNull(streams.vodCheckedAt),
          lt(streams.vodCheckedAt, now - VOD_RECHECK_MS),
        ),
      ),
    )
    .orderBy(
      sql`${streams.vodCheckedAt} is not null`,
      desc(streams.startedAt),
      desc(streams.streamId),
    )
    .limit(VOD_BATCH)
    .all();

  const byBroadcaster = new Map<string, typeof due>();
  for (const s of due) {
    const list = byBroadcaster.get(s.broadcasterId) ?? [];
    list.push(s);
    byBroadcaster.set(s.broadcasterId, list);
  }

  for (const [broadcasterId, list] of byBroadcaster) {
    let videos: Awaited<ReturnType<Helix['getVideos']>>;
    try {
      videos = await deps.helix.getVideos(broadcasterId, {
        type: 'archive',
        first: 100,
      });
    } catch (err) {
      logger.warn('vod lookup failed', {
        broadcasterId,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    const checkedAt = clock.now();
    for (const s of list) {
      result.checked++;
      const video = videos.find((v) => v.streamId === s.streamId);
      const createdAt = video ? Date.parse(video.createdAt) : Number.NaN;
      if (video && Number.isFinite(createdAt)) {
        db.update(streams)
          .set({
            vodState: 'available',
            vodId: video.id,
            vodCreatedAt: createdAt,
            vodDurationS: video.durationSeconds,
            vodMuted: JSON.stringify(video.mutedSegments),
            vodCheckedAt: checkedAt,
          })
          .where(eq(streams.streamId, s.streamId))
          .run();
        result.available++;
        bus.publish('timeline', { streamId: s.streamId });
      } else if (
        s.vodState === 'pending' &&
        s.endedAt != null &&
        checkedAt - s.endedAt > VOD_GIVE_UP_MS
      ) {
        db.update(streams)
          .set({ vodState: 'none', vodCheckedAt: checkedAt })
          .where(eq(streams.streamId, s.streamId))
          .run();
        result.none++;
        bus.publish('timeline', { streamId: s.streamId });
      } else {
        db.update(streams)
          .set({ vodCheckedAt: checkedAt })
          .where(eq(streams.streamId, s.streamId))
          .run();
      }
    }
  }
  return result;
}

export interface VodResolver {
  /** Runs once; a call while a run is in flight joins that run. */
  run(): Promise<VodResolveResult | undefined>;
  /** Debounced run, e.g. after stream.offline; never blocks the caller. */
  trigger(): void;
  stop(): void;
  /** Resolves when the in-flight run (if any) finished. */
  inFlight(): Promise<void>;
}

export const VOD_TRIGGER_DEBOUNCE_MS = 5_000;

export function createVodResolver(
  deps: VodResolverDeps & { debounceMs?: number },
): VodResolver {
  const debounceMs = deps.debounceMs ?? VOD_TRIGGER_DEBOUNCE_MS;
  let current: Promise<VodResolveResult | undefined> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function run(): Promise<VodResolveResult | undefined> {
    if (stopped) return Promise.resolve(undefined);
    current ??= resolveVods(deps)
      .catch((err: unknown) => {
        deps.logger.error('vod resolver failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        return undefined;
      })
      .finally(() => {
        current = undefined;
      });
    return current;
  }

  return {
    run,
    trigger() {
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, debounceMs);
      timer.unref?.();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
    },
    async inFlight() {
      await current;
    },
  };
}
