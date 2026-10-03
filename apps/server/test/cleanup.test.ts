import { afterEach, beforeEach, expect, test } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import {
  categorySegments,
  eventsubInbox,
  mailOutbox,
  sentNotifications,
  sessions,
  streams,
} from '../src/db/schema.ts';
import { setSetting } from '../src/db/settings.ts';
import { runCleanup } from '../src/jobs/cleanup.ts';
import { createFakeClock } from './helpers/clock.ts';
import { createTestDb } from './helpers/db.ts';
import { OWNER_ID } from './helpers/seed.ts';

const DAY = 86_400_000;
let handle: DbHandle;

beforeEach(() => {
  handle = createTestDb();
});
afterEach(() => handle.close());

test('removes only rows beyond each retention age', () => {
  const clock = createFakeClock();
  const now = clock.now();
  const { db } = handle;
  const inbox = (id: string, age: number, processed: boolean) =>
    db
      .insert(eventsubInbox)
      .values({
        messageId: id,
        type: 'notification',
        payload: '{}',
        receivedAt: now - age,
        processedAt: processed ? now - age : null,
      })
      .run();
  inbox('old-done', DAY + 1, true);
  inbox('old-open', DAY + 1, false);
  inbox('new-done', DAY - 1, true);

  const sn = (id: string, age: number) =>
    db
      .insert(sentNotifications)
      .values({
        streamId: id,
        categoryId: 'c',
        broadcasterId: 'b',
        ownerId: OWNER_ID,
        sentAt: now - age,
      })
      .run();
  sn('old', 7 * DAY + 1);
  sn('new', 7 * DAY - 1);

  const sess = (id: string, expiresAt: number) =>
    db
      .insert(sessions)
      .values({
        id,
        userId: OWNER_ID,
        createdAt: now - DAY,
        expiresAt,
        lastSeenAt: now,
      })
      .run();
  sess('expired', now - 1);
  sess('valid', now + 1);

  const ob = (status: 'sent' | 'failed', age: number) =>
    db
      .insert(mailOutbox)
      .values({
        ownerId: OWNER_ID,
        streamId: 's',
        categoryId: 'c',
        payload: '{}',
        nextAttemptAt: now - age,
        status,
        createdAt: now - 40 * DAY,
        updatedAt: now - age,
        sentAt: status === 'sent' ? now - age : null,
      })
      .run();
  ob('sent', 30 * DAY + 1);
  ob('sent', 30 * DAY - 1);
  ob('failed', 30 * DAY + 1);

  expect(runCleanup({ db, clock })).toEqual({
    inbox: 1,
    sentNotifications: 1,
    sessions: 1,
    outbox: 1,
    streams: 0,
  });
  expect(
    db
      .select()
      .from(eventsubInbox)
      .all()
      .map((r) => r.messageId)
      .sort(),
  ).toEqual(['new-done', 'old-open']);
  expect(
    db
      .select()
      .from(sentNotifications)
      .all()
      .map((r) => r.streamId),
  ).toEqual(['new']);
  expect(
    db
      .select()
      .from(sessions)
      .all()
      .map((r) => r.id),
  ).toEqual(['valid']);
  expect(db.select().from(mailOutbox).all()).toHaveLength(2);
});

function seedStreams(now: number) {
  const { db } = handle;
  const add = (id: string, endedAt: number | null) => {
    db.insert(streams)
      .values({
        streamId: id,
        broadcasterId: 'b',
        startedAt: now - 400 * DAY,
        endedAt,
      })
      .run();
    db.insert(categorySegments)
      .values({
        streamId: id,
        broadcasterId: 'b',
        categoryId: 'c',
        startedAt: now - 400 * DAY,
        endedAt,
      })
      .run();
  };
  add('old', now - 365 * DAY - 1);
  add('recent', now - 365 * DAY + 1);
  add('live', null);
}

const ids = () => ({
  streams: handle.db
    .select()
    .from(streams)
    .all()
    .map((r) => r.streamId)
    .sort(),
  segments: handle.db
    .select()
    .from(categorySegments)
    .all()
    .map((r) => r.streamId)
    .sort(),
});

test('deletes streams ended beyond 365 days with their segments, keeps live', () => {
  const clock = createFakeClock();
  setSetting(handle.db, 'segmentRetentionDays', 365);
  seedStreams(clock.now());
  expect(runCleanup({ db: handle.db, clock }).streams).toBe(1);
  expect(ids()).toEqual({
    streams: ['live', 'recent'],
    segments: ['live', 'recent'],
  });
});

test('retention 0 keeps all streams', () => {
  const clock = createFakeClock();
  setSetting(handle.db, 'segmentRetentionDays', 0);
  seedStreams(clock.now());
  expect(runCleanup({ db: handle.db, clock }).streams).toBe(0);
  expect(ids().streams).toEqual(['live', 'old', 'recent']);
  expect(ids().segments).toHaveLength(3);
});
