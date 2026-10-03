import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import { follows, sessions, streams, users } from '../db/schema.ts';
import type { Bus } from '../events/bus.ts';
import type { BusEvent } from '../shared/events.ts';
import { SESSION_MAX_MS } from './auth.ts';

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

export function isAdminAccount(db: Db, userId: number): boolean {
  return (
    db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .get()?.role === 'admin'
  );
}

/**
 * Whether the account may see `event`. Live and timeline events need the broadcaster
 * in the account's list, notification and group events the account as owner
 * (administrators see every notification, as on the history page), sync and
 * subscription events an administrator. Anything else is dropped.
 */
export function mayReceive(
  db: Db,
  userId: number,
  event: BusEvent,
  /** Role known from a recent lookup; skips the per-event role query. */
  knownAdmin?: boolean,
): boolean {
  const isAdmin = () => knownAdmin ?? isAdminAccount(db, userId);
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
      return follows_(event.payload.broadcasterId);
    case 'notification':
      return event.payload.ownerId === userId || isAdmin();
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
      return isAdmin();
    default:
      return false;
  }
}

/** True while the session row exists, has not expired and its account still exists. */
export function sessionAlive(db: Db, clock: Clock, sessionId: string): boolean {
  const row = db
    .select({
      expiresAt: sessions.expiresAt,
      createdAt: sessions.createdAt,
      passwordHash: users.passwordHash,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId))
    .get();
  if (!row?.passwordHash) return false;
  const now = clock.now();
  return row.expiresAt > now && row.createdAt + SESSION_MAX_MS > now;
}

/** Handler for `GET /api/events`: forwards the bus events the account may see as a named SSE event. */
export function sseHandler(deps: SseDeps & { db: Db; clock: Clock }) {
  const pingMs = deps.pingMs ?? SSE_PING_MS;
  return (c: Context) => {
    c.header('X-Accel-Buffering', 'no');
    const userId = c.get('user').id;
    const sessionId = c.get('sessionId');
    return streamSSE(c, async (stream) => {
      let finish = () => {};
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const ignore = () => {};
      // Session liveness and role are looked up once per ping interval, not per event.
      let live = false;
      let admin = false;
      const refresh = () => {
        try {
          live = sessionAlive(deps.db, deps.clock, sessionId);
          admin = live && isAdminAccount(deps.db, userId);
        } catch {
          live = false;
          admin = false;
        }
      };
      refresh();
      const end = () => {
        live = false;
        admin = false;
        finish();
      };
      const unsubscribe = deps.bus.subscribe((event) => {
        if (stream.closed || stream.aborted) return;
        let allowed = false;
        try {
          if (!live) {
            end();
            return;
          }
          allowed = mayReceive(deps.db, userId, event, admin);
        } catch {
          allowed = false;
        }
        if (!allowed) return;
        stream
          .writeSSE({ event: event.type, data: JSON.stringify(event.payload) })
          .catch(ignore);
      });
      const ping = setInterval(() => {
        if (stream.closed || stream.aborted) return;
        refresh();
        if (!live) {
          end();
          return;
        }
        stream.write(': ping\n\n').catch(ignore);
      }, pingMs);
      ping.unref();
      const deregister = deps.registry.add(end);
      stream.onAbort(end);
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
