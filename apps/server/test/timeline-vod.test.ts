import { describe, expect, test } from 'vitest';
import { deepLink, isMuted, vodState } from '../src/timeline/vod.ts';

const created = Date.parse('2026-01-10T18:00:05Z');
const vod = { id: '123', createdAt: created, durationSeconds: 4 * 3600 };
const at = (iso: string) => Date.parse(`2026-01-10T${iso}Z`);
const DAY = 86_400_000;

describe('deepLink', () => {
  test('spec offset example', () => {
    expect(deepLink(vod, at('20:12:35'), false)).toBe(
      'https://www.twitch.tv/videos/123?t=2h12m30s',
    );
  });
  test('drops zero hours', () => {
    expect(deepLink(vod, at('18:12:35'), false)).toMatch(/\?t=12m30s$/);
  });
  test('under 10 s gives no t', () => {
    expect(deepLink(vod, at('18:00:14'), false)).toBe(
      'https://www.twitch.tv/videos/123',
    );
    expect(deepLink(vod, at('18:00:15'), false)).toMatch(/\?t=0m10s$/);
  });
  test('approximate starts 60 s earlier, clamped at 0', () => {
    expect(deepLink(vod, at('18:05:05'), true)).toMatch(/\?t=4m0s$/);
    expect(deepLink(vod, at('18:00:35'), true)).toBe(
      'https://www.twitch.tv/videos/123',
    );
  });
  test('clamped to the duration', () => {
    expect(deepLink(vod, at('23:30:00'), false)).toMatch(/\?t=4h0m0s$/);
  });
});

describe('isMuted', () => {
  const muted = [{ offset: 3600, duration: 360 }];
  test('overlap is muted', () => {
    expect(isMuted(vod, muted, at('18:30:05'), at('19:02:05'))).toBe(true);
    expect(isMuted(vod, muted, at('19:05:05'), at('19:30:05'))).toBe(true);
  });
  test('no overlap is not muted', () => {
    expect(isMuted(vod, muted, at('18:10:05'), at('18:59:05'))).toBe(false);
    expect(isMuted(vod, muted, at('19:07:05'), at('20:00:00'))).toBe(false);
    expect(isMuted(vod, [], at('18:00:05'), at('22:00:00'))).toBe(false);
  });
});

describe('vodState', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  test('available VOD older than 60 days is likely_expired', () => {
    expect(vodState('available', now - 90 * DAY, now)).toBe('likely_expired');
    expect(vodState('available', now - 30 * DAY, now)).toBe('available');
    expect(vodState('available', null, now)).toBe('available');
  });
  test('pending and none pass through', () => {
    expect(vodState('pending', now - 90 * DAY, now)).toBe('pending');
    expect(vodState('none', now - 90 * DAY, now)).toBe('none');
  });
});
