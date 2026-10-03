import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Db } from '../db/client.ts';
import { follows, streams, users } from '../db/schema.ts';
import type { Bus } from '../events/bus.ts';
import type { BusEvent } from '../shared/events.ts';

export const SSE_PING_MS = 20_000;

export interface SseRegistry {
  /** Registers an open stream's close callback; returns the deregistration function. */
  add(close: () => void): () => void;
  /** Ends every open stream (used on shutdown). */
  closeAll(): void;
  size(): number;
}

export function createSseRegistry(): SseRegistry {
  const open = new Set<() => void>();
  return {
    add(close) {
      open.add(close);
      return () => {
        open.delete(close);
      };
    },
    closeAll() {
      for (const close of [...open]) close();
      open.clear();
    },
    size: () => open.size,
  };
}

export interface SseDeps {
  bus: Bus;
  registry: SseRegistry;
  pingMs?: number;
}

/**
 * Whether the account may see `event`. Live, timeline and notification events need
 * the broadcaster in the account's list, group events the account as owner, sync and
 * subscription events an administrator. Anything else is dropped.
 */
export function mayReceive(db: Db, userId: number, event: BusEvent): boolean {
  const follows_ = (broadcasterId: string | undefined) =>
    broadcasterId !== undefined &&
    !!db
      .select({ id: follows.broadcasterId })
      .from(follows)
      .where(
        and(
          eq(follows.ownerId, userId),
          eq(follows.broadcasterId, broadcasterId),
        ),
      )
      .get();
  switch (event.type) {
    case 'live-state':
    case 'notification':
      return follows_(event.payload.broadcasterId);
    case 'timeline':
      return follows_(
        db
          .select({ b: streams.broadcasterId })
          .from(streams)
          .where(eq(streams.streamId, event.payload.streamId))
          .get()?.b,
      );
    case 'groups':
      return event.payload.ownerId === userId;
    case 'sync':
    case 'subscriptions':
      return (
        db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, userId))
          .get()?.role === 'admin'
      );
    default:
      return false;
  }
}

/** Handler for `GET /api/events`: forwards the bus events the account may see as a named SSE event. */
export function sseHandler(deps: SseDeps & { db: Db }) {
  const pingMs = deps.pingMs ?? SSE_PING_MS;
  return (c: Context) => {
    c.header('X-Accel-Buffering', 'no');
    const userId = c.get('user').id;
    return streamSSE(c, async (stream) => {
      let finish = () => {};
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const ignore = () => {};
      const unsubscribe = deps.bus.subscribe((event) => {
        if (stream.closed || stream.aborted) return;
        if (!mayReceive(deps.db, userId, event)) return;
        stream
          .writeSSE({ event: event.type, data: JSON.stringify(event.payload) })
          .catch(ignore);
      });
      const ping = setInterval(() => {
        if (!stream.closed && !stream.aborted)
          stream.write(': ping\n\n').catch(ignore);
      }, pingMs);
      ping.unref();
      const deregister = deps.registry.add(finish);
      stream.onAbort(finish);
      try {
        await finished;
      } finally {
        clearInterval(ping);
        unsubscribe();
        deregister();
      }
    });
  };
}
