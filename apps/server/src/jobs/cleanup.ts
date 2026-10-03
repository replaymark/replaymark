import { and, eq, isNotNull, lt } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import {
  eventsubInbox,
  mailOutbox,
  sentNotifications,
  sessions,
  streams,
} from '../db/schema.ts';
import { getSegmentRetentionDays } from '../db/settings.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const INBOX_RETENTION_MS = DAY;
export const SENT_NOTIFICATION_RETENTION_MS = 7 * DAY;
export const OUTBOX_SENT_RETENTION_MS = 30 * DAY;

export interface CleanupResult {
  inbox: number;
  sentNotifications: number;
  sessions: number;
  outbox: number;
  /** Ended streams past the segment retention; their segments cascade. */
  streams: number;
}

export function runCleanup(deps: { db: Db; clock: Clock }): CleanupResult {
  const { db } = deps;
  const now = deps.clock.now();
  const retentionDays = getSegmentRetentionDays(db);
  return db.transaction((tx) => ({
    inbox: tx
      .delete(eventsubInbox)
      .where(
        and(
          isNotNull(eventsubInbox.processedAt),
          lt(eventsubInbox.receivedAt, now - INBOX_RETENTION_MS),
        ),
      )
      .run().changes,
    sentNotifications: tx
      .delete(sentNotifications)
      .where(lt(sentNotifications.sentAt, now - SENT_NOTIFICATION_RETENTION_MS))
      .run().changes,
    sessions: tx.delete(sessions).where(lt(sessions.expiresAt, now)).run()
      .changes,
    outbox: tx
      .delete(mailOutbox)
      .where(
        and(
          eq(mailOutbox.status, 'sent'),
          lt(mailOutbox.sentAt, now - OUTBOX_SENT_RETENTION_MS),
        ),
      )
      .run().changes,
    streams: deleteExpiredStreams(tx, now, retentionDays),
  }));
}

/** Retention 0 keeps everything; open (live) streams are never removed. */
function deleteExpiredStreams(
  tx: Pick<Db, 'delete'>,
  now: number,
  days: number,
): number {
  if (days <= 0) return 0;
  return tx
    .delete(streams)
    .where(
      and(isNotNull(streams.endedAt), lt(streams.endedAt, now - days * DAY)),
    )
    .run().changes;
}
