import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  localDayBounds,
  parseTimelineSearch,
  segmentDuration,
  stripParts,
  timelineQueryParams,
  toggleStreamer,
} from './timeline.ts';

const MIN = 60_000;
const H = 60 * MIN;

describe('parseTimelineSearch', () => {
  it('keeps valid params', () => {
    expect(
      parseTimelineSearch({
        categoryId: '32982',
        streamers: ['1', '2'],
        from: '2026-09-01',
        to: '2026-09-28',
        page: 2,
      }),
    ).toEqual({
      categoryId: '32982',
      streamers: ['1', '2'],
      from: '2026-09-01',
      to: '2026-09-28',
      page: 2,
    });
  });
  it('accepts numeric ids and comma lists', () => {
    expect(
      parseTimelineSearch({ categoryId: 42, streamers: '3, 4,3' }),
    ).toEqual({ categoryId: '42', streamers: ['3', '4'] });
  });
  it('drops garbage', () => {
    expect(
      parseTimelineSearch({
        categoryId: 'abc',
        streamers: ['x'],
        from: '2026-02-30',
        to: '28.09.2026',
        page: 1,
      }),
    ).toEqual({});
  });
  it('swaps a reversed range', () => {
    expect(
      parseTimelineSearch({ from: '2026-09-10', to: '2026-09-01' }),
    ).toEqual({ from: '2026-09-01', to: '2026-09-10' });
  });
});

describe('localDayBounds', () => {
  it('spans whole local days', () => {
    const b = localDayBounds('2026-09-01', '2026-09-02');
    expect(b.from).toBe(new Date(2026, 8, 1).getTime());
    expect(b.to).toBe(new Date(2026, 8, 3).getTime() - 1);
  });
  it('handles one-sided and invalid bounds', () => {
    expect(localDayBounds(undefined, '2026-09-02')).toEqual({
      to: new Date(2026, 8, 3).getTime() - 1,
    });
    expect(localDayBounds('nope')).toEqual({});
  });
});

describe('timelineQueryParams', () => {
  it('omits the category for recent streams', () => {
    expect(timelineQueryParams({ from: '2026-09-01' })).toEqual({
      page: '1',
      streamerIds: '',
      from: new Date(2026, 8, 1).getTime(),
    });
  });
  it('maps to wire strings with epoch bounds', () => {
    expect(
      timelineQueryParams({
        categoryId: '7',
        streamers: ['1', '2'],
        from: '2026-09-01',
        to: '2026-09-01',
        page: 3,
      }),
    ).toEqual({
      categoryId: '7',
      page: '3',
      streamerIds: '1,2',
      from: new Date(2026, 8, 1).getTime(),
      to: new Date(2026, 8, 2).getTime() - 1,
    });
    expect(timelineQueryParams({ categoryId: '7' })).toEqual({
      categoryId: '7',
      page: '1',
      streamerIds: '',
    });
  });
});

describe('toggleStreamer', () => {
  it('adds, removes and resets paging', () => {
    expect(toggleStreamer({ categoryId: '7', page: 2 }, '1')).toEqual({
      categoryId: '7',
      streamers: ['1'],
    });
    expect(toggleStreamer({ streamers: ['1'] }, '1')).toEqual({});
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '< 1 min'],
    [59_999, '< 1 min'],
    [45 * MIN, '45 min'],
    [H, '1 h 00 min'],
    [2 * H + 5 * MIN + 30_000, '2 h 05 min'],
    [-5, '< 1 min'],
  ])('%i ms -> %s', (ms, out) => {
    expect(formatDuration(ms)).toBe(out);
  });
});

describe('segmentDuration', () => {
  it('counts open segments up to now', () => {
    expect(segmentDuration({ startedAt: 0, endedAt: null }, 5 * MIN)).toBe(
      5 * MIN,
    );
    expect(segmentDuration({ startedAt: 0, endedAt: H }, 5 * H)).toBe(H);
  });
});

describe('stripParts', () => {
  const seg = (
    categoryId: string,
    startedAt: number,
    endedAt: number | null,
  ) => ({
    categoryId,
    startedAt,
    endedAt,
  });
  const sum = (ps: { percent: number }[]) =>
    ps.reduce((a, p) => a + p.percent, 0);

  it('sizes by duration and highlights the chosen game', () => {
    const parts = stripParts(
      [seg('1', 0, 3 * H), seg('2', 3 * H, 4 * H)],
      10 * H,
      '2',
    );
    expect(parts.map((p) => p.percent)).toEqual([75, 25]);
    expect(parts.map((p) => p.highlighted)).toEqual([false, true]);
  });
  it('treats open segments up to now', () => {
    const parts = stripParts([seg('1', 0, H), seg('2', H, null)], 2 * H);
    expect(parts.map((p) => p.percent)).toEqual([50, 50]);
    expect(parts[1]?.open).toBe(true);
  });
  it('keeps tiny segments visible and totals 100', () => {
    const parts = stripParts(
      [
        seg('1', 0, 9 * H),
        seg('2', 9 * H, 9 * H + MIN),
        seg('1', 9 * H + MIN, 10 * H),
      ],
      10 * H,
    );
    expect(parts[1]?.percent).toBe(1.5);
    expect(sum(parts)).toBeCloseTo(100);
  });
  it('splits evenly when nothing has length', () => {
    expect(
      stripParts([seg('1', 0, 0), seg('2', 0, 0)], 0).map((p) => p.percent),
    ).toEqual([50, 50]);
    expect(stripParts([], 0)).toEqual([]);
  });
});
