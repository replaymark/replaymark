import type { MutedSegment } from '../twitch/helix.ts';

export type StoredVodState = 'pending' | 'available' | 'none';
export type VodState = StoredVodState | 'likely_expired';

export interface VodRef {
  id: string;
  /** VOD creation time, epoch ms. */
  createdAt: number;
  durationSeconds: number;
}

const APPROX_LEAD_S = 60;
const MIN_OFFSET_S = 10;
export const VOD_EXPIRY_MS = 60 * 24 * 60 * 60 * 1000;

export function formatOffset(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h > 0 ? `${h}h` : ''}${m}m${sec}s`;
}

/** Offset of `at` (epoch ms) into the VOD in whole seconds, clamped to [0, duration]. */
export function vodOffset(vod: VodRef, at: number, approx = false): number {
  let offset = Math.floor((at - vod.createdAt) / 1000);
  if (approx) offset -= APPROX_LEAD_S;
  return Math.min(Math.max(offset, 0), Math.max(vod.durationSeconds, 0));
}

/** Deep link to the VOD at the segment start (D5). */
export function deepLink(
  vod: VodRef,
  segmentStart: number,
  approx: boolean,
): string {
  const base = `https://www.twitch.tv/videos/${vod.id}`;
  const offset = vodOffset(vod, segmentStart, approx);
  return offset < MIN_OFFSET_S ? base : `${base}?t=${formatOffset(offset)}`;
}

/** True when [segStart, segEnd] (epoch ms) intersects any muted range of the VOD. */
export function isMuted(
  vod: Pick<VodRef, 'createdAt'>,
  muted: readonly MutedSegment[],
  segStart: number,
  segEnd: number,
): boolean {
  const a = (segStart - vod.createdAt) / 1000;
  const b = (segEnd - vod.createdAt) / 1000;
  return muted.some((m) => a <= m.offset + m.duration && b >= m.offset);
}

/** Reported VOD state; an available VOD whose stream ended > 60 days ago is likely expired. */
export function vodState(
  stored: StoredVodState,
  endedAt: number | null,
  now: number,
): VodState {
  if (
    stored === 'available' &&
    endedAt !== null &&
    now - endedAt > VOD_EXPIRY_MS
  )
    return 'likely_expired';
  return stored;
}
