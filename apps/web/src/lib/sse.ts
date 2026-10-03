import type { EventType } from '@shared/events.ts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, queryKeys } from './api.ts';

const INVALIDATE: Record<EventType, readonly (readonly string[])[]> = {
  // Live state also moves open segments and the live badge on the timeline.
  'live-state': [queryKeys.streamers, queryKeys.overview, queryKeys.timeline],
  subscriptions: [queryKeys.subscriptions, queryKeys.overview],
  sync: [queryKeys.subscriptions, queryKeys.overview],
  // The live-card mail line reads from the streamers query.
  notification: [
    queryKeys.notifications,
    queryKeys.overview,
    queryKeys.streamers,
  ],
  timeline: [queryKeys.timeline],
  // Group edits move mode lines, search and counts on the roster and overview.
  groups: [queryKeys.gameGroups, queryKeys.streamers, queryKeys.overview],
};

export const SSE_MIN_DELAY = 1_000;
export const SSE_MAX_DELAY = 30_000;

export function nextDelay(current: number): number {
  return Math.min(current * 2, SSE_MAX_DELAY);
}

/** Subscribes to `/api/events` and invalidates queries per event type (D9). */
export function useServerEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = SSE_MIN_DELAY;
    let closed = false;

    const connect = () => {
      source = new EventSource('/api/events', { withCredentials: true });
      source.onopen = () => {
        delay = SSE_MIN_DELAY;
      };
      for (const type of Object.keys(INVALIDATE) as EventType[]) {
        source.addEventListener(type, () => {
          for (const key of INVALIDATE[type]) {
            void qc.invalidateQueries({ queryKey: key });
          }
        });
      }
      source.onerror = () => {
        source?.close();
        source = null;
        if (closed) return;
        // EventSource hides the status; a 401 surfaces via /me and redirects.
        void api.api.auth.me.$get().catch(() => {});
        timer = setTimeout(connect, delay);
        delay = nextDelay(delay);
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [qc]);
}
