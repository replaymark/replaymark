import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import {
  appMeta,
  type MailLanguage,
  settings,
  userRecipients,
  users,
} from './schema.ts';

export type { MailLanguage };

export interface Settings {
  syncIntervalHours: number;
  /** Days to keep ended streams and segments; 0 keeps forever. */
  segmentRetentionDays: number;
}

export const settingDefaults: Settings = {
  syncIntervalHours: 6,
  segmentRetentionDays: 365,
};

const DEFAULT_MAIL_LANGUAGE: MailLanguage = 'de';

/** Storage key overrides; other settings are stored under their property name. */
const storageKeys: Partial<Record<keyof Settings, string>> = {
  segmentRetentionDays: 'segment_retention_days',
};

function storageKey(key: keyof Settings): string {
  return storageKeys[key] ?? key;
}

export function getSetting<K extends keyof Settings>(
  db: Db,
  key: K,
): Settings[K] {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, storageKey(key)))
    .get();
  if (!row) return structuredClone(settingDefaults[key]);
  return JSON.parse(row.value) as Settings[K];
}

export function setSetting<K extends keyof Settings>(
  db: Db,
  key: K,
  value: Settings[K],
): void {
  const json = JSON.stringify(value);
  db.insert(settings)
    .values({ key: storageKey(key), value: json })
    .onConflictDoUpdate({ target: settings.key, set: { value: json } })
    .run();
}

export function getAllSettings(db: Db): Settings {
  return {
    syncIntervalHours: getSetting(db, 'syncIntervalHours'),
    segmentRetentionDays: getSetting(db, 'segmentRetentionDays'),
  };
}

/** Lowest-id account with role admin (CLI import and test mail). */
export function firstAdminId(db: Db): number {
  const row = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
    .orderBy(asc(users.id))
    .get();
  if (!row) throw new Error('no administrator account exists');
  return row.id;
}

/** Mail recipients of one account, in insertion order. */
export function getRecipients(db: Db, userId: number): string[] {
  return db
    .select({ email: userRecipients.email })
    .from(userRecipients)
    .where(eq(userRecipients.userId, userId))
    .orderBy(asc(sql`rowid`))
    .all()
    .map((r) => r.email);
}

/** Replaces the recipients of one account (duplicates dropped). */
export function setRecipients(db: Db, userId: number, emails: string[]): void {
  db.transaction((tx) => {
    tx.delete(userRecipients).where(eq(userRecipients.userId, userId)).run();
    const unique = [...new Set(emails)];
    if (unique.length > 0)
      tx.insert(userRecipients)
        .values(unique.map((email) => ({ userId, email })))
        .run();
  });
}

export function getMailLanguage(db: Db, userId: number): MailLanguage {
  const user = db
    .select({ lang: users.mailLanguage })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return user?.lang ?? DEFAULT_MAIL_LANGUAGE;
}

export function setMailLanguage(
  db: Db,
  userId: number,
  lang: MailLanguage,
): void {
  db.update(users)
    .set({ mailLanguage: lang })
    .where(eq(users.id, userId))
    .run();
}

/** Retention for ended streams and their segments, in days; 0 = keep forever. */
export function getSegmentRetentionDays(db: Db): number {
  return getSetting(db, 'segmentRetentionDays');
}

export function getMeta<T>(db: Db, key: string): T | undefined {
  const row = db.select().from(appMeta).where(eq(appMeta.key, key)).get();
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function setMeta(db: Db, key: string, value: unknown): void {
  const json = JSON.stringify(value);
  db.insert(appMeta)
    .values({ key, value: json })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: json } })
    .run();
}

const RECORDING_SINCE_KEY = 'timeline_recording_since';

/**
 * Records when timeline recording started (epoch ms). Written once, on the
 * first startup with timeline support; later calls never overwrite it.
 */
export function ensureRecordingSince(db: Db, now: number): number {
  db.insert(settings)
    .values({ key: RECORDING_SINCE_KEY, value: JSON.stringify(now) })
    .onConflictDoNothing({ target: settings.key })
    .run();
  return getRecordingSince(db) ?? now;
}

export function getRecordingSince(db: Db): number | undefined {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, RECORDING_SINCE_KEY))
    .get();
  return row ? (JSON.parse(row.value) as number) : undefined;
}
