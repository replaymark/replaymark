import type { TimelineSegment } from '@shared/schemas.ts';

/** Timeline page search state; dates stay readable (YYYY-MM-DD, local days). */
export interface TimelineSearch {
  categoryId?: string;
  streamers?: string[];
  from?: string;
  to?: string;
  page?: number;
}

const ID_RE = /^\d+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` -> local midnight, or null when not a real calendar date. */
function localMidnight(date: string): Date | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const out = new Date(y, mo - 1, d);
  if (
    out.getFullYear() !== y ||
    out.getMonth() !== mo - 1 ||
    out.getDate() !== d
  )
    return null;
  return out;
}

export function isDate(v: unknown): v is string {
  return typeof v === 'string' && localMidnight(v) !== null;
}

function idList(v: unknown): string[] {
  const raw = Array.isArray(v)
    ? v.map(String)
    : typeof v === 'string' || typeof v === 'number'
      ? String(v).split(',')
      : [];
  return [...new Set(raw.map((s) => s.trim()).filter((s) => ID_RE.test(s)))];
}

/** Router search params -> clean state; anything invalid is dropped. */
export function parseTimelineSearch(
  raw: Record<string, unknown>,
): TimelineSearch {
  const out: TimelineSearch = {};
  const cat = raw.categoryId;
  if (
    (typeof cat === 'string' || typeof cat === 'number') &&
    ID_RE.test(String(cat))
  )
    out.categoryId = String(cat);
  const streamers = idList(raw.streamers);
  if (streamers.length > 0) out.streamers = streamers;
  if (isDate(raw.from)) out.from = raw.from;
  if (isDate(raw.to)) out.to = raw.to;
  if (out.from && out.to && out.from > out.to) {
    const from = out.from;
    out.from = out.to;
    out.to = from;
  }
  const page = Number(raw.page);
  if (Number.isInteger(page) && page > 1) out.page = page;
  return out;
}

/**
 * Local calendar days -> inclusive epoch ms bounds: `from` is the start of its
 * day, `to` the last millisecond of its day, both in the browser's time zone.
 */
export function localDayBounds(
  from?: string,
  to?: string,
): { from?: number; to?: number } {
  const out: { from?: number; to?: number } = {};
  const f = from ? localMidnight(from) : null;
  if (f) out.from = f.getTime();
  const t = to ? localMidnight(to) : null;
  if (t) {
    const next = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
    out.to = next.getTime() - 1;
  }
  return out;
}

/** Search state -> `GET /api/timeline` query; no category means recent streams. */
export function timelineQueryParams(search: TimelineSearch): {
  categoryId?: string;
  page: string;
  /** Always sent (the RPC type requires it); empty means all streamers. */
  streamerIds: string;
  /** Epoch ms; the RPC client sends them as strings. */
  from?: number;
  to?: number;
} {
  const b = localDayBounds(search.from, search.to);
  return {
    ...(search.categoryId ? { categoryId: search.categoryId } : {}),
    page: String(search.page ?? 1),
    streamerIds: search.streamers?.join(',') ?? '',
    ...(b.from !== undefined ? { from: b.from } : {}),
    ...(b.to !== undefined ? { to: b.to } : {}),
  };
}

/** Toggles one streamer in the filter; changing a filter resets paging. */
export function toggleStreamer(
  search: TimelineSearch,
  id: string,
): TimelineSearch {
  const cur = search.streamers ?? [];
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  const { page: _page, streamers: _s, ...rest } = search;
  return next.length > 0 ? { ...rest, streamers: next } : rest;
}

const MIN = 60_000;

/** Compact, language-neutral duration: `45 min`, `2 h 05 min`, `< 1 min`. */
export function formatDuration(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / MIN);
  if (total < 1) return '< 1 min';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Duration of a segment; open ones count up to `now`. */
export function segmentDuration(
  s: Pick<TimelineSegment, 'startedAt' | 'endedAt'>,
  now: number,
): number {
  return Math.max(0, (s.endedAt ?? now) - s.startedAt);
}

export interface StripPart {
  index: number;
  /** Share of the strip in percent; all parts sum to 100. */
  percent: number;
  highlighted: boolean;
  open: boolean;
}

/**
 * Proportional strip: each segment sized by its duration (open ones up to
 * `now`). Tiny segments get at least `minPercent` so they stay visible; the
 * rest is scaled down to keep the total at 100.
 */
export function stripParts(
  segments: readonly Pick<
    TimelineSegment,
    'startedAt' | 'endedAt' | 'categoryId'
  >[],
  now: number,
  highlightId?: string,
  minPercent = 1.5,
): StripPart[] {
  if (segments.length === 0) return [];
  const durations = segments.map((s) => segmentDuration(s, now));
  const total = durations.reduce((a, b) => a + b, 0);
  const raw =
    total > 0
      ? durations.map((d) => (d / total) * 100)
      : durations.map(() => 100 / segments.length);
  const min = Math.min(minPercent, 100 / segments.length);
  const small = raw.filter((p) => p < min).length;
  const bigSum = raw.filter((p) => p >= min).reduce((a, b) => a + b, 0);
  const scale = bigSum > 0 ? (100 - small * min) / bigSum : 0;
  return segments.map((s, index) => {
    const p = raw[index] ?? 0;
    return {
      index,
      percent: p < min ? min : p * scale,
      highlighted: highlightId !== undefined && s.categoryId === highlightId,
      open: s.endedAt === null,
    };
  });
}
