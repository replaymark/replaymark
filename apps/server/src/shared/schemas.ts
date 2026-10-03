// Zod input schemas and API DTO types, shared between server and web.
// No server-only imports: this file is bundled into the SPA.
import { z } from 'zod';

// ---------- inputs ----------

const twitchLogin = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{1,25}$/, 'Invalid Twitch login');

const categoryId = z.string().trim().regex(/^\d+$/, 'Invalid category id');

export const gameModeSchema = z.enum(['default', 'custom', 'any']);
export const mailLanguageSchema = z.enum(['de', 'en']);
export const notificationStatusSchema = z.enum(['pending', 'sent', 'failed']);

export const addStreamerInput = z.object({ login: twitchLogin });

export const lookupStreamerQuery = z.object({ login: twitchLogin });

export const patchStreamerInput = z.object({
  gameMode: gameModeSchema.optional(),
  categoryIds: z.array(categoryId).max(100).optional(),
  enabled: z.boolean().optional(),
  groupIds: z.array(z.number().int().positive()).max(50).optional(),
});

const groupName = z.string().trim().min(1).max(60);

export const createGameGroupInput = z.object({
  name: groupName,
  categoryIds: z.array(categoryId).max(100),
});

export const patchGameGroupInput = z.object({
  name: groupName.optional(),
  categoryIds: z.array(categoryId).max(100).optional(),
});

export const settingsInput = z.object({
  syncIntervalHours: z.number().int().min(1).max(168),
  /** Optional so older clients keep working; omitted keeps the stored value. */
  segmentRetentionDays: z.number().int().min(0).max(3650).optional(),
});

export const patchAccountInput = z
  .object({
    email: z.email().optional(),
    recipients: z.array(z.email()).min(1).optional(),
    mailLanguage: mailLanguageSchema.optional(),
  })
  .refine(
    (v) =>
      v.email !== undefined ||
      v.recipients !== undefined ||
      v.mailLanguage !== undefined,
    { message: 'Nothing to change' },
  );

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/);
export const newPasswordSchema = z.string().min(8).max(200);

export const loginInput = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});
export const setupInput = z.object({
  code: z.string().min(1),
  username: usernameSchema,
  email: z.email(),
  password: newPasswordSchema,
});
export const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: newPasswordSchema,
});

export const createUserInput = z.object({
  username: usernameSchema,
  email: z.email(),
  role: z.enum(['admin', 'user']),
});
export const patchUserInput = z
  .object({
    role: z.enum(['admin', 'user']).optional(),
    resetPassword: z.literal(true).optional(),
  })
  .refine((v) => v.role !== undefined || v.resetPassword === true, {
    message: 'Nothing to change',
  });

/** Parses `pending,sent` into statuses; null when any entry is unknown. */
export function parseStatusList(value: string): NotificationStatus[] | null {
  const parsed = z
    .array(notificationStatusSchema)
    .min(1)
    .safeParse(value.split(',').map((x) => x.trim()));
  return parsed.success ? parsed.data : null;
}

export const notificationsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** One status or a comma-separated list (`pending,sent`). */
  status: z
    .string()
    .transform((v, ctx) => {
      const list = parseStatusList(v);
      if (!list) {
        ctx.addIssue({ code: 'custom', message: 'Unknown status' });
        return z.NEVER;
      }
      return list;
    })
    .optional(),
});

export const categorySearchQuery = z.object({
  q: z.string().trim().min(2).max(100),
});

export type AddStreamerInput = z.input<typeof addStreamerInput>;
export type PatchStreamerInput = z.input<typeof patchStreamerInput>;
export type CreateGameGroupInput = z.input<typeof createGameGroupInput>;
export type PatchGameGroupInput = z.input<typeof patchGameGroupInput>;
export type PatchAccountInput = z.input<typeof patchAccountInput>;
export type SettingsInput = z.input<typeof settingsInput>;
export type LoginInput = z.input<typeof loginInput>;
export type SetupInput = z.input<typeof setupInput>;
export type CreateUserInput = z.input<typeof createUserInput>;
export type PatchUserInput = z.input<typeof patchUserInput>;

export interface UserItem {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
  streamerCount: number;
  mustChangePassword: boolean;
}
export interface UserWithPassword {
  user: UserItem;
  temporaryPassword: string;
}
export type ChangePasswordInput = z.input<typeof changePasswordInput>;
export type NotificationsQuery = z.input<typeof notificationsQuery>;
export type CategorySearchQuery = z.input<typeof categorySearchQuery>;

// ---------- DTOs (times are ISO strings) ----------

export type GameMode = z.infer<typeof gameModeSchema>;
export type MailLanguage = z.infer<typeof mailLanguageSchema>;
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;
export type SubscriptionState = 'enabled' | 'pending' | 'error' | 'missing';

export const SUBSCRIPTION_TYPES = [
  'stream.online',
  'stream.offline',
  'channel.update',
] as const;
export type SubscriptionType = (typeof SUBSCRIPTION_TYPES)[number];

export interface Category {
  id: string;
  name: string;
  boxArtUrl: string | null;
}

export interface GameGroup {
  id: number;
  name: string;
  isDefault: boolean;
  games: Category[];
  streamerCount: number;
}

export interface StreamerLookup {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
  alreadyAdded: boolean;
}

export interface StreamerMail {
  status: NotificationStatus;
  at: string;
  error: string | null;
}

export interface Streamer {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
  gameMode: GameMode;
  enabled: boolean;
  /** Custom game list (only relevant when gameMode is 'custom'). */
  categories: Category[];
  /** Assigned non-default game groups, sorted by name. */
  groups: { id: number; name: string }[];
  live: boolean;
  streamId: string | null;
  title: string | null;
  startedAt: string | null;
  currentCategory: Category | null;
  /** Live and the current category matches the streamer's game rule. */
  matches: boolean;
  subscriptions: Record<SubscriptionType, SubscriptionState>;
  /** End of the most recent recorded stream; null if never recorded. */
  lastLiveAt: string | null;
  /** Latest mail for the current live stream; null when offline or none queued. */
  mail: StreamerMail | null;
  createdAt: string;
}

export interface SyncResultDto {
  at: string;
  ok: boolean;
  active: number;
  created: number;
  deleted: number;
  errors: string[];
}

export interface Overview {
  streamers: { total: number; enabled: number; live: number; matching: number };
  /** Null for role `user`: subscriptions are shared infrastructure. */
  subscriptions: { active: number; expected: number } | null;
  notifications: {
    pending: number;
    failed: number;
    lastError: string | null;
  };
  recipients: number;
  /** Null for role `user`. */
  lastSync: SyncResultDto | null;
}

export interface Subscription {
  id: string;
  type: string;
  version: string;
  broadcasterId: string;
  login: string | null;
  status: string;
  state: SubscriptionState;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: number;
  /** Username of the owning account; only set for administrators. */
  owner: string | null;
  streamId: string;
  broadcasterId: string;
  login: string | null;
  displayName: string | null;
  categoryId: string;
  gameName: string | null;
  boxArtUrl: string | null;
  title: string | null;
  status: NotificationStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
  /** ISO time of the next send attempt; only set while pending. */
  nextAttemptAt: string | null;
}

export interface NotificationCounts {
  all: number;
  pending: number;
  sent: number;
  failed: number;
}

export interface NotificationPage {
  items: NotificationItem[];
  page: number;
  pageSize: number;
  total: number;
  counts: NotificationCounts;
}

export interface Settings {
  syncIntervalHours: number;
  /** Days to keep ended streams and segments; 0 keeps forever. */
  segmentRetentionDays: number;
  /** Read-only, from env. */
  callbackUrl: string;
}

export interface Account {
  id: number;
  username: string;
  email: string;
  recipients: string[];
  mailLanguage: MailLanguage;
}

export interface TestMailResponse {
  ok: true;
}

// ---------- timeline (times are epoch ms, formatted by the browser) ----------

/** Query-string epoch ms: a non-negative integer. */
const epochMs = z
  .string()
  .regex(/^\d{1,15}$/, 'Invalid time (epoch ms)')
  .transform(Number);

/**
 * `GET /api/timeline`. `streamerIds` is a comma-separated list of broadcaster
 * ids. `from`/`to` are epoch ms matched against the stream start, both
 * inclusive. The browser sends the start and end of the operator's local days,
 * so the server needs no time zone.
 */
export const timelineQuery = z
  .object({
    categoryId: categoryId.optional(),
    streamerIds: z
      .string()
      .optional()
      .transform((s) =>
        s
          ? [
              ...new Set(
                s
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              ),
            ]
          : [],
      )
      .pipe(z.array(z.string().regex(/^\d+$/, 'Invalid streamer id')).max(100)),
    from: epochMs.optional(),
    to: epochMs.optional(),
    page: z.coerce.number().int().min(1).default(1),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['to'],
  });

export type TimelineQuery = z.input<typeof timelineQuery>;

export const TIMELINE_PAGE_SIZE = 20;

export type TimelineVodState =
  | 'pending'
  | 'available'
  | 'none'
  | 'likely_expired';

export interface TimelineBroadcaster {
  id: string;
  /** Null when the streamer was removed after recording. */
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface TimelineSegment {
  categoryId: string;
  categoryName: string;
  /** Twitch `{width}x{height}` template. */
  boxArtUrl: string | null;
  startedAt: number;
  /** Null while the segment is open. */
  endedAt: number | null;
  /** Open segments count up to now. */
  durationMs: number;
  startApprox: boolean;
  endApprox: boolean;
  /** Intersects a muted range of the VOD. */
  muted: boolean;
  /** VOD deep link at the segment start; null without a VOD. */
  link: string | null;
  /** True when a category was queried and this segment belongs to it. */
  match: boolean;
}

export interface TimelineStream {
  streamId: string;
  broadcaster: TimelineBroadcaster;
  startedAt: number;
  endedAt: number | null;
  endApprox: boolean;
  live: boolean;
  vodState: TimelineVodState;
  /** VOD base link; null without a VOD. */
  vodUrl: string | null;
  segments: TimelineSegment[];
}

export interface TimelinePage {
  items: TimelineStream[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  /** When timeline recording started (epoch ms); nothing earlier exists. */
  recordingSince: number;
}

/** A stream with all of its segments in order. */
export type StreamDetail = TimelineStream;

export interface RecordedCategory {
  id: string;
  name: string;
  boxArtUrl: string | null;
  streamCount: number;
  lastPlayedAt: number;
}
