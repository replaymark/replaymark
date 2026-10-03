import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Bus } from '../events/bus.ts';

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

/** Handler for `GET /api/events`: forwards every bus event as a named SSE event. */
export function sseHandler(deps: SseDeps) {
  const pingMs = deps.pingMs ?? SSE_PING_MS;
  return (c: Context) => {
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      let finish = () => {};
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const ignore = () => {};
      const unsubscribe = deps.bus.subscribe((event) => {
        if (stream.closed || stream.aborted) return;
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
