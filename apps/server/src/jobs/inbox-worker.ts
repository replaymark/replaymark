import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { eventsubInbox } from '../db/schema.ts';
import type { Logger } from '../log.ts';
import {
  applyEvent,
  type EventsubDeps,
  PermanentEventError,
} from '../twitch/eventsub.ts';

export const INBOX_POLL_MS = 30_000;
/** Transient failures (e.g. Helix down) are retried this often before giving up. */
export const INBOX_MAX_ATTEMPTS = 5;
/** Backoff before retry n (1-based): RETRY_BASE_MS * 2^(n-1). */
export const INBOX_RETRY_BASE_MS = 15_000;

export interface InboxWorkerDeps extends EventsubDeps {
  logger: Logger;
}

export interface InboxWorker {
  /** Schedules a drain; concurrent wakes coalesce into at most one follow-up run. */
  wake(): void;
  drain(): Promise<void>;
  start(): void;
  stop(): void;
}

interface Body {
  subscription?: { type?: unknown };
  event?: unknown;
}

export function createInboxWorker(deps: InboxWorkerDeps): InboxWorker {
  const { db, logger, clock } = deps;
  let running: Promise<void> | undefined;
  let again = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let started = false;

  function scheduleRetry(delay: number) {
    if (!started || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void drain();
    }, delay);
    retryTimer.unref?.();
  }

  async function processRow(row: typeof eventsubInbox.$inferSelect) {
    let error: string | null = null;
    try {
      if (row.type === 'notification') {
        const body = JSON.parse(row.payload) as Body;
        const type = body.subscription?.type;
        if (typeof type !== 'string')
          throw new PermanentEventError('missing subscription type');
        if (!body.event || typeof body.event !== 'object')
          throw new PermanentEventError('missing event');
        await applyEvent(
          deps,
          type,
          body.event as Record<string, unknown>,
          row.receivedAt,
        );
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      const attempts = row.attempts + 1;
      if (
        !(err instanceof PermanentEventError) &&
        !(err instanceof SyntaxError) &&
        attempts < INBOX_MAX_ATTEMPTS
      ) {
        const delay = INBOX_RETRY_BASE_MS * 2 ** (attempts - 1);
        logger.warn('inbox event failed, will retry', {
          messageId: row.messageId,
          error,
          attempts,
        });
        db.update(eventsubInbox)
          .set({ attempts, nextAttemptAt: clock.now() + delay })
          .where(eq(eventsubInbox.messageId, row.messageId))
          .run();
        scheduleRetry(delay);
        return;
      }
      logger.error('inbox event failed', { messageId: row.messageId, error });
    }
    db.update(eventsubInbox)
      .set({ processedAt: clock.now(), error })
      .where(eq(eventsubInbox.messageId, row.messageId))
      .run();
  }

  async function runOnce(): Promise<void> {
    for (;;) {
      const row = db
        .select()
        .from(eventsubInbox)
        .where(
          and(
            isNull(eventsubInbox.processedAt),
            isNull(eventsubInbox.error),
            or(
              isNull(eventsubInbox.nextAttemptAt),
              lte(eventsubInbox.nextAttemptAt, clock.now()),
            ),
          ),
        )
        .orderBy(asc(eventsubInbox.receivedAt), asc(sql`rowid`))
        .limit(1)
        .get();
      if (!row) return;
      await processRow(row);
    }
  }

  function drain(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await runOnce();
        } while (again);
      } catch (err) {
        logger.error('inbox drain failed', { error: err });
      } finally {
        running = undefined;
      }
    })();
    return running;
  }

  return {
    wake() {
      void drain();
    },
    drain,
    start() {
      if (timer) return;
      started = true;
      timer = setInterval(() => void drain(), INBOX_POLL_MS);
      timer.unref?.();
      void drain();
    },
    stop() {
      if (timer) clearInterval(timer);
      if (retryTimer) clearTimeout(retryTimer);
      timer = undefined;
      retryTimer = undefined;
      started = false;
    },
  };
}
