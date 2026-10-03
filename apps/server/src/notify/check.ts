import { and, eq } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import {
  categories,
  follows,
  liveState,
  mailOutbox,
  sentNotifications,
  streamers,
} from '../db/schema.ts';
import { getMailLanguage, getRecipients } from '../db/settings.ts';
import type { Bus } from '../events/bus.ts';
import { renderNotificationMail } from '../mail/render.ts';
import { categoryMatches } from './match.ts';

export interface NotifyDeps {
  db: Db;
  clock: Clock;
  /** IANA zone for the mail timestamp; defaults to `process.env.TZ` or Europe/Berlin. */
  timeZone?: string;
  bus?: Bus;
  /** Called after a mail was queued (outbox wake). */
  onQueued?: () => void;
  /** PUBLIC_BASE_URL for the admin UI footer link. */
  adminUrl?: string;
}

export interface OutboxPayload {
  subject: string;
  text: string;
  html: string;
  recipients: string[];
  login: string;
  displayName: string;
  gameName: string;
  boxArtUrl: string | null;
  title: string;
}

export function defaultTimeZone(): string {
  return process.env.TZ || 'Europe/Berlin';
}

/** Queues one mail per (stream, category, account) for every account whose follow matches. */
export function maybeNotify(deps: NotifyDeps, broadcasterId: string): boolean {
  const { db } = deps;
  const state = db
    .select()
    .from(liveState)
    .where(eq(liveState.broadcasterId, broadcasterId))
    .get();
  const streamId = state?.streamId;
  const categoryId = state?.categoryId;
  if (!state || !streamId || !categoryId) return false;

  const owners = db
    .select({ ownerId: follows.ownerId })
    .from(follows)
    .where(
      and(eq(follows.broadcasterId, broadcasterId), eq(follows.enabled, true)),
    )
    .orderBy(follows.ownerId)
    .all()
    .map((r) => r.ownerId)
    .filter((ownerId) =>
      categoryMatches(db, broadcasterId, categoryId, ownerId),
    );

  let any = false;
  for (const ownerId of owners)
    if (queueForOwner(deps, ownerId, broadcasterId, state)) any = true;
  if (any) {
    deps.bus?.publish('notification', { streamId, categoryId, broadcasterId });
    deps.onQueued?.();
  }
  return any;
}

function queueForOwner(
  deps: NotifyDeps,
  ownerId: number,
  broadcasterId: string,
  state: typeof liveState.$inferSelect,
): boolean {
  const { db, clock } = deps;
  const streamId = state.streamId as string;
  const categoryId = state.categoryId as string;
  const now = clock.now();
  return db.transaction((tx) => {
    const inserted = tx
      .insert(sentNotifications)
      .values({
        streamId,
        categoryId,
        broadcasterId,
        ownerId: ownerId,
        sentAt: now,
      })
      .onConflictDoNothing()
      .run();
    if (inserted.changes === 0) return false;
    const streamer = tx
      .select()
      .from(streamers)
      .where(eq(streamers.userId, broadcasterId))
      .get();
    const category = tx
      .select()
      .from(categories)
      .where(eq(categories.categoryId, categoryId))
      .get();
    const login = streamer?.login ?? broadcasterId;
    const displayName = streamer?.displayName ?? login;
    const gameName = state.categoryName ?? category?.name ?? categoryId;
    const boxArtUrl = category?.boxArtUrl ?? null;
    const title = state.title ?? '';
    const mail = renderNotificationMail({
      lang: getMailLanguage(tx, ownerId),
      displayName,
      login,
      gameName,
      title,
      boxArtUrl,
      at: now,
      timeZone: deps.timeZone ?? defaultTimeZone(),
      adminUrl: deps.adminUrl,
    });
    const payload: OutboxPayload = {
      ...mail,
      recipients: getRecipients(tx, ownerId),
      login,
      displayName,
      gameName,
      boxArtUrl,
      title,
    };
    tx.insert(mailOutbox)
      .values({
        ownerId: ownerId,
        streamId,
        broadcasterId,
        categoryId,
        payload: JSON.stringify(payload),
        attempts: 0,
        nextAttemptAt: now,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return true;
  });
}
