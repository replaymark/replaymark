import { and, asc, eq, lte } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import { mailOutbox } from '../db/schema.ts';
import type { Bus } from '../events/bus.ts';
import type { Logger } from '../log.ts';
import type { Mailer } from '../mail/mailer.ts';
import type { OutboxPayload } from '../notify/check.ts';

export const OUTBOX_POLL_MS = 15_000;
/** Delay before attempt n+1 after the n-th failure. */
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000] as const;
export const MAX_ATTEMPTS = 3;

export interface OutboxWorkerDeps {
  db: Db;
  mailer: Mailer;
  clock: Clock;
  logger: Logger;
  bus?: Bus;
}

export interface OutboxWorker {
  processDue(): Promise<void>;
  wake(): void;
  start(): void;
  stop(): void;
  /** Re-queues a `failed` row; false for any other row. */
  retry(id: number): boolean;
  /** Resolves once the current run (if any) has finished. */
  inFlight(): Promise<void>;
}

type Row = typeof mailOutbox.$inferSelect;

export function createOutboxWorker(deps: OutboxWorkerDeps): OutboxWorker {
  const { db, mailer, clock, logger, bus } = deps;
  let running: Promise<void> | undefined;
  let again = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  // Set by stop(): late wake() calls (e.g. from a draining inbox) must not start sends.
  let stopped = false;

  function publish(row: Row, status: 'sent' | 'failed') {
    if (!bus) return;
    bus.publish('notification', {
      ownerId: row.ownerId,
      streamId: row.streamId,
      categoryId: row.categoryId,
      broadcasterId: row.broadcasterId,
      status,
      outboxId: row.id,
    });
  }

  async function processRow(row: Row) {
    try {
      const payload = JSON.parse(row.payload) as OutboxPayload;
      await mailer.send({
        to: payload.recipients,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });
      const sentAt = clock.now();
      db.update(mailOutbox)
        .set({ status: 'sent', lastError: null, sentAt, updatedAt: sentAt })
        .where(eq(mailOutbox.id, row.id))
        .run();
      logger.info('notification mail sent', { outboxId: row.id });
      publish(row, 'sent');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = row.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      const delay =
        RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length) - 1] ?? 0;
      const now = clock.now();
      db.update(mailOutbox)
        .set({
          attempts,
          updatedAt: now,
          lastError: message,
          nextAttemptAt: now + delay,
          status: failed ? 'failed' : 'pending',
        })
        .where(eq(mailOutbox.id, row.id))
        .run();
      logger.warn('notification mail failed', {
        outboxId: row.id,
        attempts,
        error: message,
      });
      if (failed) publish(row, 'failed');
    }
  }

  async function runOnce(): Promise<void> {
    const seen = new Set<number>();
    for (;;) {
      const row = db
        .select()
        .from(mailOutbox)
        .where(
          and(
            eq(mailOutbox.status, 'pending'),
            lte(mailOutbox.nextAttemptAt, clock.now()),
          ),
        )
        .orderBy(asc(mailOutbox.createdAt), asc(mailOutbox.id))
        .limit(1)
        .get();
      if (!row || seen.has(row.id)) return;
      seen.add(row.id);
      await processRow(row);
    }
  }

  function processDue(): Promise<void> {
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
        logger.error('outbox run failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        running = undefined;
      }
    })();
    return running;
  }

  return {
    processDue,
    wake() {
      if (stopped) return;
      void processDue();
    },
    start() {
      stopped = false;
      if (timer) return;
      timer = setInterval(() => void processDue(), OUTBOX_POLL_MS);
      timer.unref();
      void processDue();
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    retry(id) {
      const res = db
        .update(mailOutbox)
        .set({
          status: 'pending',
          attempts: 0,
          nextAttemptAt: clock.now(),
          updatedAt: clock.now(),
          sentAt: null,
        })
        .where(and(eq(mailOutbox.id, id), eq(mailOutbox.status, 'failed')))
        .run();
      return res.changes > 0;
    },
    async inFlight() {
      await running;
    },
  };
}
