import type {
  GameGroup,
  Overview,
  Streamer,
  SubscriptionType,
} from '@shared/schemas.ts';
import { SUBSCRIPTION_TYPES } from '@shared/schemas.ts';

/** Live streamers, earliest start first (a real broadcast sequence). */
export function liveInOrder(list: readonly Streamer[]): Streamer[] {
  const time = (s: Streamer) =>
    s.startedAt ? Date.parse(s.startedAt) : Number.POSITIVE_INFINITY;
  return list
    .filter((s) => s.live)
    .sort(
      (a, b) => time(a) - time(b) || a.displayName.localeCompare(b.displayName),
    );
}

/** Roster order: alphabetical by display name, case-insensitive. */
export function rosterOrder(list: readonly Streamer[]): Streamer[] {
  return [...list].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, {
      sensitivity: 'base',
    }),
  );
}

export type RosterFilter = 'live' | 'active' | 'paused';

export const ROSTER_FILTERS = ['live', 'active', 'paused'] as const;

export interface RosterSearch {
  q?: string;
  filter?: RosterFilter;
}

/** Router search params -> clean state; invalid values and defaults are dropped. */
export function parseRosterSearch(raw: Record<string, unknown>): RosterSearch {
  const out: RosterSearch = {};
  if (typeof raw.q === 'string' && raw.q.trim() !== '') out.q = raw.q;
  const filter = ROSTER_FILTERS.find((f) => f === raw.filter);
  if (filter) out.filter = filter;
  return out;
}

export interface RosterQuery {
  q?: string | undefined;
  filter?: RosterFilter | undefined;
}

/**
 * Names of the streamer's effective game list: custom = own games plus the games
 * of assigned groups; default = games of the default group; none for any.
 */
export function gameList(
  s: Pick<Streamer, 'gameMode' | 'categories'> & {
    groups?: readonly { id: number }[];
  },
  groups: readonly Pick<GameGroup, 'id' | 'isDefault' | 'games'>[],
): string[] {
  if (s.gameMode === 'any') return [];
  if (s.gameMode === 'default') {
    const names = groups.filter((g) => g.isDefault).flatMap((g) => g.games);
    return [...new Set(names.map((c) => c.name))];
  }
  const assigned = new Set((s.groups ?? []).map((g) => g.id));
  const names = [
    ...s.categories.map((c) => c.name),
    ...groups
      .filter((g) => assigned.has(g.id))
      .flatMap((g) => g.games.map((c) => c.name)),
  ];
  return [...new Set(names)];
}

/** Whole hours and minutes since `startedAt`, floored, never negative. */
export function liveDuration(
  startedAt: string,
  now: Date,
): { hours: number; minutes: number } {
  const totalMinutes = Math.max(
    0,
    Math.floor((now.getTime() - Date.parse(startedAt)) / 60_000),
  );
  return {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}

/** Case-insensitive search on name, login, current game and game list, then the filter. */
export function filterRoster(
  list: readonly Streamer[],
  { q, filter }: RosterQuery,
  groups: readonly Pick<GameGroup, 'id' | 'isDefault' | 'games'>[] = [],
): Streamer[] {
  const needle = (q ?? '').trim().toLowerCase();
  return list.filter((s) => {
    if (needle) {
      const haystack = [
        s.displayName,
        s.login,
        s.currentCategory?.name ?? '',
        ...(s.gameMode === 'custom' ? (s.groups ?? []) : []).map((g) => g.name),
        ...gameList(s, groups),
      ];
      if (!haystack.some((h) => h.toLowerCase().includes(needle))) return false;
    }
    if (filter === 'live') return s.live;
    if (filter === 'active') return s.enabled;
    if (filter === 'paused') return !s.enabled;
    return true;
  });
}

/** Counts per filter option, for the segment labels. */
export function rosterCounts(
  list: readonly Streamer[],
): Record<RosterFilter | 'all', number> {
  return {
    all: list.length,
    live: list.filter((s) => s.live).length,
    active: list.filter((s) => s.enabled).length,
    paused: list.filter((s) => !s.enabled).length,
  };
}

export type RowStatus =
  | { key: 'live'; since: string }
  | { key: 'lastLive'; at: string }
  | { key: 'never' }
  | { key: 'paused' };

/** Second line of a roster row. Paused wins over everything. */
export function rowStatus(
  s: Pick<Streamer, 'enabled' | 'live' | 'startedAt' | 'lastLiveAt'>,
): RowStatus {
  if (!s.enabled) return { key: 'paused' };
  if (s.live && s.startedAt) return { key: 'live', since: s.startedAt };
  if (s.lastLiveAt) return { key: 'lastLive', at: s.lastLiveAt };
  return { key: 'never' };
}

export interface SubscriptionIssue {
  count: number;
  state: 'error' | 'missing' | 'pending';
}

/** Worst non-enabled subscription state (error > missing > pending) with its count; null when all enabled. */
export function subscriptionIssue(
  s: Pick<Streamer, 'subscriptions' | 'enabled'>,
): SubscriptionIssue | null {
  if (!s.enabled) return null;
  const states = SUBSCRIPTION_TYPES.map(
    (type) => s.subscriptions[type] ?? 'missing',
  );
  for (const state of ['error', 'missing', 'pending'] as const) {
    const count = states.filter((x) => x === state).length;
    if (count > 0) return { count, state };
  }
  return null;
}

export type LiveReason =
  | { key: 'paused' }
  | { key: 'noMatch'; mode: 'default' | 'custom' }
  | {
      key: 'match';
      mail: 'sent' | 'failed' | 'pending' | 'none';
      at: string | null;
    };

/** Why a live card does or does not trigger a mail. */
export function liveReason(
  s: Pick<Streamer, 'enabled' | 'matches' | 'gameMode' | 'mail'>,
): LiveReason {
  if (!s.enabled) return { key: 'paused' };
  if (!s.matches)
    return {
      key: 'noMatch',
      mode: s.gameMode === 'custom' ? 'custom' : 'default',
    };
  return {
    key: 'match',
    mail: s.mail?.status ?? 'none',
    at: s.mail?.at ?? null,
  };
}

export type ModeLabel =
  | { key: 'default' }
  | { key: 'any' }
  | { key: 'custom'; count: number; groups: string[] };

export function modeLabel(
  s: Pick<Streamer, 'gameMode' | 'categories'> & {
    groups?: readonly { name: string }[];
  },
): ModeLabel {
  if (s.gameMode === 'custom')
    return {
      key: 'custom',
      count: s.categories.length,
      groups: (s.groups ?? []).map((g) => g.name),
    };
  return { key: s.gameMode };
}

/** IDs live now that were known and not live before. */
export function newlyLive(
  previous: ReadonlyMap<string, boolean> | null,
  list: readonly Streamer[],
): string[] {
  if (!previous) return [];
  return list
    .filter((s) => s.live && previous.get(s.id) === false)
    .map((s) => s.id);
}

export type AttentionItem =
  | { kind: 'failedMails'; count: number }
  | {
      kind: 'subscription';
      streamer: Pick<Streamer, 'id' | 'displayName'>;
      types: SubscriptionType[];
      state: 'error' | 'missing';
    }
  | { kind: 'syncFailed'; at: string; errors: string[] };

/**
 * Conditions that need the operator: failed sync, failed mails, then broken
 * subscriptions of enabled streamers (by display name; `error` before
 * `missing` per streamer). `pending` is not an attention item.
 */
export function attentionItems(
  overview: Pick<Overview, 'notifications' | 'lastSync' | 'subscriptions'>,
  streamers: readonly Streamer[],
): AttentionItem[] {
  const items: AttentionItem[] = [];
  // `subscriptions` is null for role user: shared infrastructure, not theirs.
  const shared = overview.subscriptions !== null;
  const sync = overview.lastSync;
  if (shared && sync && !sync.ok)
    items.push({ kind: 'syncFailed', at: sync.at, errors: sync.errors });
  if (overview.notifications.failed > 0)
    items.push({ kind: 'failedMails', count: overview.notifications.failed });
  const roster = shared ? rosterOrder(streamers.filter((x) => x.enabled)) : [];
  for (const st of roster) {
    for (const state of ['error', 'missing'] as const) {
      const types = SUBSCRIPTION_TYPES.filter(
        (type) => (st.subscriptions[type] ?? 'missing') === state,
      );
      if (types.length)
        items.push({
          kind: 'subscription',
          streamer: { id: st.id, displayName: st.displayName },
          types,
          state,
        });
    }
  }
  return items;
}
