import type { Clock } from '../clock.ts';
import type { TokenProvider } from './token.ts';

export const HELIX_BASE = 'https://api.twitch.tv/helix';
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_CAP_MS = 60_000;

export type QueryValue = string | number | boolean | undefined;
export type Query = Record<string, QueryValue | QueryValue[]>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
}

export class HelixError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.name = 'HelixError';
    this.status = status;
    this.body = body;
  }
}

export interface HelixOptions {
  clientId: string;
  token: TokenProvider;
  fetch: typeof fetch;
  clock: Clock;
  /** Returns a value in [0, 1); injectable for deterministic jitter. */
  random?: () => number;
}

export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
  profileImageUrl: string;
}
export interface TwitchCategory {
  id: string;
  name: string;
  boxArtUrl: string;
}
export interface TwitchStream {
  id: string;
  userId: string;
  userLogin: string;
  userName: string;
  gameId: string;
  gameName: string;
  title: string;
  startedAt: string;
}
export interface TwitchChannel {
  broadcasterId: string;
  broadcasterLogin: string;
  broadcasterName: string;
  gameId: string;
  gameName: string;
  title: string;
}
export interface MutedSegment {
  /** Offset from the start of the video, in seconds. */
  offset: number;
  /** Length of the muted range, in seconds. */
  duration: number;
}
export interface TwitchVideo {
  id: string;
  streamId: string;
  userId: string;
  createdAt: string;
  /** Duration in seconds, parsed from Twitch's `1h2m3s` format. */
  durationSeconds: number;
  type: string;
  mutedSegments: MutedSegment[];
}
export interface TwitchSubscription {
  id: string;
  status: string;
  type: string;
  version: string;
  condition: Record<string, string>;
  callback: string | undefined;
  createdAt: string;
}
export interface CreateSubscriptionInput {
  type: string;
  version: string;
  broadcasterId: string;
  callback: string;
  secret: string;
}

export function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query ?? {})) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) if (v !== undefined) params.append(key, String(v));
  }
  const qs = params.toString();
  return `${HELIX_BASE}${path}${qs ? `?${qs}` : ''}`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

type Raw = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const n = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

/** Parses Twitch's duration format (`3h8m33s`, `12m`, `45s`) into seconds; 0 if malformed. */
export function parseTwitchDuration(value: string): number {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value.trim());
  if (!m || value.trim() === '') return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function parseMutedSegments(v: unknown): MutedSegment[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Raw => typeof x === 'object' && x !== null)
    .map((x) => ({ offset: n(x.offset), duration: n(x.duration) }));
}

/** Maps a raw Helix/EventSub subscription object (list or webhook body). */
export function parseSubscription(r: Raw): TwitchSubscription {
  const transport = (r.transport ?? {}) as Raw;
  return {
    id: s(r.id),
    status: s(r.status),
    type: s(r.type),
    version: s(r.version),
    condition: (r.condition ?? {}) as Record<string, string>,
    callback:
      typeof transport.callback === 'string' ? transport.callback : undefined,
    createdAt: s(r.created_at),
  };
}

export function createHelix(opts: HelixOptions) {
  const random = opts.random ?? Math.random;

  function backoffMs(n: number): number {
    const base = Math.min(30_000, 500 * 2 ** n);
    const jitter = base * 0.2 * (random() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }

  async function request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = buildUrl(path, options.query);
    let refreshed = false;
    let failures = 0;
    let lastError: HelixError | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const token = await opts.token.getToken();
      const headers: Record<string, string> = {
        'Client-Id': opts.clientId,
        Authorization: `Bearer ${token}`,
      };
      if (options.body !== undefined)
        headers['Content-Type'] = 'application/json';
      let res: Response;
      try {
        res = await opts.fetch(url, {
          method,
          headers,
          body:
            options.body === undefined
              ? undefined
              : JSON.stringify(options.body),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastError = new HelixError(
          0,
          '',
          `Helix ${method} ${path} network error: ${msg}`,
        );
        await opts.clock.sleep(backoffMs(failures++));
        continue;
      }
      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }
      const snippet = (await res.text().catch(() => '')).slice(0, 300);
      lastError = new HelixError(
        res.status,
        snippet,
        `Helix ${method} ${path} failed (${res.status}): ${snippet}`,
      );
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        opts.token.invalidate();
        continue;
      }
      if (res.status === 429) {
        const reset = Number(res.headers.get('Ratelimit-Reset'));
        const wait = Number.isFinite(reset)
          ? Math.min(
              RATE_LIMIT_CAP_MS,
              Math.max(0, reset * 1000 - opts.clock.now()),
            )
          : 1000;
        await opts.clock.sleep(wait);
        continue;
      }
      if (res.status >= 500) {
        if (attempt < MAX_ATTEMPTS - 1)
          await opts.clock.sleep(backoffMs(failures++));
        continue;
      }
      throw lastError;
    }
    throw lastError ?? new HelixError(0, '', `Helix ${method} ${path} failed`);
  }

  async function getData(path: string, query: Query): Promise<Raw[]> {
    const res = await request<{ data?: Raw[] }>('GET', path, { query });
    return res?.data ?? [];
  }

  async function chunked(
    path: string,
    key: string,
    ids: readonly string[],
  ): Promise<Raw[]> {
    const out: Raw[] = [];
    for (const part of chunk(ids, 100))
      out.push(...(await getData(path, { [key]: part, first: 100 })));
    return out;
  }

  const toCategory = (r: Raw): TwitchCategory => ({
    id: s(r.id),
    name: s(r.name),
    boxArtUrl: s(r.box_art_url),
  });

  return {
    request,

    async getUsersByLogin(logins: readonly string[]): Promise<TwitchUser[]> {
      const out: Raw[] = [];
      for (const part of chunk(logins, 100))
        out.push(...(await getData('/users', { login: part })));
      return out.map((r) => ({
        id: s(r.id),
        login: s(r.login),
        displayName: s(r.display_name),
        profileImageUrl: s(r.profile_image_url),
      }));
    },

    async searchCategories(query: string): Promise<TwitchCategory[]> {
      return (await getData('/search/categories', { query, first: 20 })).map(
        toCategory,
      );
    },

    async getGames(input: {
      ids?: readonly string[];
      names?: readonly string[];
    }): Promise<TwitchCategory[]> {
      const ids = input.ids ?? [];
      const names = input.names ?? [];
      if (ids.length === 0 && names.length === 0) return [];
      return (await getData('/games', { id: [...ids], name: [...names] })).map(
        toCategory,
      );
    },

    async getStreams(userIds: readonly string[]): Promise<TwitchStream[]> {
      return (await chunked('/streams', 'user_id', userIds)).map((r) => ({
        id: s(r.id),
        userId: s(r.user_id),
        userLogin: s(r.user_login),
        userName: s(r.user_name),
        gameId: s(r.game_id),
        gameName: s(r.game_name),
        title: s(r.title),
        startedAt: s(r.started_at),
      }));
    },

    async getChannels(
      broadcasterIds: readonly string[],
    ): Promise<TwitchChannel[]> {
      const out: Raw[] = [];
      for (const part of chunk(broadcasterIds, 100))
        out.push(...(await getData('/channels', { broadcaster_id: part })));
      return out.map((r) => ({
        broadcasterId: s(r.broadcaster_id),
        broadcasterLogin: s(r.broadcaster_login),
        broadcasterName: s(r.broadcaster_name),
        gameId: s(r.game_id),
        gameName: s(r.game_name),
        title: s(r.title),
      }));
    },

    async getVideos(
      userId: string,
      options: { type?: 'archive' | 'all'; first?: number } = {},
    ): Promise<TwitchVideo[]> {
      const rows = await getData('/videos', {
        user_id: userId,
        type: options.type ?? 'archive',
        first: options.first ?? 100,
      });
      return rows.map((r) => ({
        id: s(r.id),
        streamId: s(r.stream_id),
        userId: s(r.user_id),
        createdAt: s(r.created_at),
        durationSeconds: parseTwitchDuration(s(r.duration)),
        type: s(r.type),
        mutedSegments: parseMutedSegments(r.muted_segments),
      }));
    },

    async listSubscriptions(): Promise<TwitchSubscription[]> {
      const out: TwitchSubscription[] = [];
      let after: string | undefined;
      do {
        const res = await request<{
          data?: Raw[];
          pagination?: { cursor?: string };
        }>('GET', '/eventsub/subscriptions', { query: { after } });
        for (const r of res?.data ?? []) {
          out.push(parseSubscription(r));
        }
        after = res?.pagination?.cursor || undefined;
      } while (after);
      return out;
    },

    async createSubscription(input: CreateSubscriptionInput): Promise<string> {
      const res = await request<{ data?: Raw[] }>(
        'POST',
        '/eventsub/subscriptions',
        {
          body: {
            type: input.type,
            version: input.version,
            condition: { broadcaster_user_id: input.broadcasterId },
            transport: {
              method: 'webhook',
              callback: input.callback,
              secret: input.secret,
            },
          },
        },
      );
      return s(res?.data?.[0]?.id);
    },

    async deleteSubscription(id: string): Promise<void> {
      await request('DELETE', '/eventsub/subscriptions', { query: { id } });
    },
  };
}

export type Helix = ReturnType<typeof createHelix>;
