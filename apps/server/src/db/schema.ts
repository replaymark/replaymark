import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// All timestamps are integer epoch milliseconds.

export type GameMode = 'default' | 'custom' | 'any';
export type MailStatus = 'pending' | 'sent' | 'failed';
export type VodState = 'pending' | 'available' | 'none';
export type UserRole = 'admin' | 'user';
export type MailLanguage = 'de' | 'en';

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    email: text('email').notNull().default(''),
    /** Null until the account has a password (setup or hash takeover). */
    passwordHash: text('password_hash'),
    role: text('role').$type<UserRole>().notNull().default('user'),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    mailLanguage: text('mail_language')
      .$type<MailLanguage>()
      .notNull()
      .default('de'),
    createdAt: integer('created_at').notNull().default(0),
  },
  (t) => [uniqueIndex('users_username_idx').on(sql`lower(${t.username})`)],
);

export const userRecipients = sqliteTable(
  'user_recipients',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.email] })],
);

export const streamers = sqliteTable('streamers', {
  userId: text('user_id').primaryKey(),
  login: text('login').notNull(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at').notNull(),
});

export const follows = sqliteTable(
  'follows',
  {
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    broadcasterId: text('broadcaster_id')
      .notNull()
      .references(() => streamers.userId, { onDelete: 'cascade' }),
    gameMode: text('game_mode').$type<GameMode>().notNull().default('default'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.broadcasterId] }),
    index('follows_broadcaster_idx').on(t.broadcasterId),
  ],
);

export const categories = sqliteTable('categories', {
  categoryId: text('category_id').primaryKey(),
  name: text('name').notNull(),
  boxArtUrl: text('box_art_url'),
});

export const streamerGames = sqliteTable(
  'streamer_games',
  {
    ownerId: integer('owner_id').notNull(),
    /** Broadcaster id. */
    userId: text('user_id').notNull(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.categoryId),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.userId, t.categoryId] }),
    foreignKey({
      columns: [t.ownerId, t.userId],
      foreignColumns: [follows.ownerId, follows.broadcasterId],
    }).onDelete('cascade'),
  ],
);

export const gameGroups = sqliteTable(
  'game_groups',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: integer('created_at').notNull().default(0),
  },
  (t) => [
    uniqueIndex('game_groups_owner_name_idx').on(
      t.ownerId,
      sql`lower(${t.name})`,
    ),
    uniqueIndex('game_groups_default_idx')
      .on(t.ownerId)
      .where(sql`${t.isDefault} = 1`),
  ],
);

export const gameGroupCategories = sqliteTable(
  'game_group_categories',
  {
    groupId: integer('group_id')
      .notNull()
      .references(() => gameGroups.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.categoryId),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.categoryId] })],
);

export const streamerGroups = sqliteTable(
  'streamer_groups',
  {
    ownerId: integer('owner_id').notNull(),
    /** Broadcaster id. */
    userId: text('user_id').notNull(),
    groupId: integer('group_id')
      .notNull()
      .references(() => gameGroups.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.ownerId, t.userId, t.groupId] }),
    foreignKey({
      columns: [t.ownerId, t.userId],
      foreignColumns: [follows.ownerId, follows.broadcasterId],
    }).onDelete('cascade'),
  ],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const subscriptions = sqliteTable('subscriptions', {
  twitchSubId: text('twitch_sub_id').primaryKey(),
  type: text('type').notNull(),
  version: text('version').notNull(),
  broadcasterId: text('broadcaster_id').notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const liveState = sqliteTable('live_state', {
  broadcasterId: text('broadcaster_id').primaryKey(),
  streamId: text('stream_id'),
  categoryId: text('category_id'),
  categoryName: text('category_name'),
  title: text('title'),
  startedAt: integer('started_at'),
  updatedAt: integer('updated_at').notNull(),
  /** Last time an EventSub event touched this row; live sync defers to it for a grace period. */
  eventAt: integer('event_at'),
});

export const eventsubInbox = sqliteTable(
  'eventsub_inbox',
  {
    messageId: text('message_id').primaryKey(),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    receivedAt: integer('received_at').notNull(),
    processedAt: integer('processed_at'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at'),
  },
  (t) => [
    index('eventsub_inbox_processed_received_idx').on(
      t.processedAt,
      t.receivedAt,
    ),
  ],
);

export const sentNotifications = sqliteTable(
  'sent_notifications',
  {
    streamId: text('stream_id').notNull(),
    categoryId: text('category_id').notNull(),
    broadcasterId: text('broadcaster_id').notNull(),
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sentAt: integer('sent_at').notNull(),
  },
  (t) => [
    uniqueIndex('sent_notifications_stream_category_uq').on(
      t.streamId,
      t.categoryId,
      t.ownerId,
    ),
    index('sent_notifications_owner_idx').on(t.ownerId),
  ],
);

export const mailOutbox = sqliteTable(
  'mail_outbox',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    streamId: text('stream_id').notNull(),
    broadcasterId: text('broadcaster_id').notNull().default(''),
    categoryId: text('category_id').notNull(),
    payload: text('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at').notNull(),
    lastError: text('last_error'),
    status: text('status').$type<MailStatus>().notNull().default('pending'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull().default(0),
    sentAt: integer('sent_at'),
  },
  (t) => [
    index('mail_outbox_status_next_idx').on(t.status, t.nextAttemptAt),
    index('mail_outbox_stream_idx').on(t.streamId),
    index('mail_outbox_owner_idx').on(t.ownerId),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const streams = sqliteTable(
  'streams',
  {
    streamId: text('stream_id').primaryKey(),
    broadcasterId: text('broadcaster_id').notNull(),
    startedAt: integer('started_at').notNull(),
    /** Null while the stream is live. */
    endedAt: integer('ended_at'),
    endApprox: integer('end_approx', { mode: 'boolean' })
      .notNull()
      .default(false),
    vodId: text('vod_id'),
    vodCreatedAt: integer('vod_created_at'),
    vodDurationS: integer('vod_duration_s'),
    /** JSON array of `{ offset, duration }` in seconds. */
    vodMuted: text('vod_muted'),
    vodState: text('vod_state').$type<VodState>().notNull().default('pending'),
    vodCheckedAt: integer('vod_checked_at'),
  },
  (t) => [
    index('streams_broadcaster_ended_idx').on(t.broadcasterId, t.endedAt),
  ],
);

export const categorySegments = sqliteTable(
  'category_segments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    streamId: text('stream_id')
      .notNull()
      .references(() => streams.streamId, { onDelete: 'cascade' }),
    broadcasterId: text('broadcaster_id').notNull(),
    categoryId: text('category_id').notNull(),
    categoryName: text('category_name'),
    startedAt: integer('started_at').notNull(),
    /** Null while the segment is open. */
    endedAt: integer('ended_at'),
    startApprox: integer('start_approx', { mode: 'boolean' })
      .notNull()
      .default(false),
    endApprox: integer('end_approx', { mode: 'boolean' })
      .notNull()
      .default(false),
  },
  (t) => [
    index('category_segments_category_started_idx').on(
      t.categoryId,
      t.startedAt,
    ),
    index('category_segments_stream_started_idx').on(t.streamId, t.startedAt),
  ],
);
