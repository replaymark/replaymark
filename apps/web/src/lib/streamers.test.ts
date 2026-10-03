import type { Category, Overview, Streamer } from '@shared/schemas.ts';
import { describe, expect, it } from 'vitest';
import {
  attentionItems,
  filterRoster,
  gameList,
  liveDuration,
  liveInOrder,
  liveReason,
  modeLabel,
  newlyLive,
  parseRosterSearch,
  rosterCounts,
  rosterOrder,
  rowStatus,
  subscriptionIssue,
} from './streamers.ts';

function s(p: Partial<Streamer> & { id: string }): Streamer {
  return {
    login: p.id,
    displayName: p.id,
    avatarUrl: null,
    gameMode: 'default',
    enabled: true,
    categories: [],
    groups: [],
    live: false,
    streamId: null,
    title: null,
    startedAt: null,
    currentCategory: null,
    matches: false,
    subscriptions: {
      'stream.online': 'enabled',
      'stream.offline': 'enabled',
      'channel.update': 'enabled',
    },
    lastLiveAt: null,
    mail: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...p,
  };
}

describe('liveInOrder', () => {
  it('keeps only live streamers, earliest start first', () => {
    const list = [
      s({ id: 'c', live: true, startedAt: '2026-01-01T20:00:00Z' }),
      s({ id: 'a', live: false }),
      s({ id: 'b', live: true, startedAt: '2026-01-01T19:02:00Z' }),
      s({ id: 'd', live: true, startedAt: null }),
    ];
    expect(liveInOrder(list).map((x) => x.id)).toEqual(['b', 'c', 'd']);
  });
});

describe('rosterOrder', () => {
  it('sorts case-insensitively without mutating', () => {
    const list = [
      s({ id: 'b', displayName: 'beta' }),
      s({ id: 'a', displayName: 'Alpha' }),
    ];
    expect(rosterOrder(list).map((x) => x.id)).toEqual(['a', 'b']);
    expect(list[0]?.id).toBe('b');
  });
});

describe('rowStatus', () => {
  it('lets paused win over live', () => {
    expect(
      rowStatus(s({ id: 'x', enabled: false, live: true, startedAt: 'T' })),
    ).toEqual({ key: 'paused' });
  });
  it('reports live since the start', () => {
    expect(
      rowStatus(s({ id: 'x', live: true, startedAt: '2026-01-02T10:00:00Z' })),
    ).toEqual({ key: 'live', since: '2026-01-02T10:00:00Z' });
  });
  it('reports the last live time', () => {
    expect(
      rowStatus(s({ id: 'x', lastLiveAt: '2026-01-01T10:00:00Z' })),
    ).toEqual({ key: 'lastLive', at: '2026-01-01T10:00:00Z' });
  });
  it('reports never when nothing is recorded', () => {
    expect(rowStatus(s({ id: 'x' }))).toEqual({ key: 'never' });
  });
});

describe('parseRosterSearch', () => {
  it('drops an invalid filter', () => {
    expect(parseRosterSearch({ filter: 'bogus' })).toEqual({});
  });
  it('drops a blank or whitespace q', () => {
    expect(parseRosterSearch({ q: '' })).toEqual({});
    expect(parseRosterSearch({ q: '   ' })).toEqual({});
  });
  it('omits defaults for empty input', () => {
    expect(parseRosterSearch({})).toEqual({});
  });
  it('keeps valid values', () => {
    expect(parseRosterSearch({ q: 'abc', filter: 'live' })).toEqual({
      q: 'abc',
      filter: 'live',
    });
  });
});

describe('liveReason', () => {
  const live = { live: true, startedAt: '2026-01-01T10:00:00Z' };
  it('reports paused', () => {
    expect(
      liveReason(s({ id: 'x', ...live, enabled: false, matches: true })),
    ).toEqual({ key: 'paused' });
  });
  it('reports noMatch for the default list', () => {
    expect(liveReason(s({ id: 'x', ...live }))).toEqual({
      key: 'noMatch',
      mode: 'default',
    });
  });
  it('reports noMatch for a custom list', () => {
    expect(liveReason(s({ id: 'x', ...live, gameMode: 'custom' }))).toEqual({
      key: 'noMatch',
      mode: 'custom',
    });
  });
  it.each(['sent', 'failed', 'pending'] as const)(
    'match with mail %s',
    (status) => {
      expect(
        liveReason(
          s({
            id: 'x',
            ...live,
            matches: true,
            mail: { status, at: '2026-01-01T10:05:00Z', error: null },
          }),
        ),
      ).toEqual({ key: 'match', mail: status, at: '2026-01-01T10:05:00Z' });
    },
  );
  it('match with no mail yet', () => {
    expect(liveReason(s({ id: 'x', ...live, matches: true }))).toEqual({
      key: 'match',
      mail: 'none',
      at: null,
    });
  });
});

describe('subscriptionIssue', () => {
  it('is null when all are enabled', () => {
    expect(subscriptionIssue(s({ id: 'x' }))).toBeNull();
  });
  it('is null for paused streamers', () => {
    expect(subscriptionIssue(s({ id: 'x', enabled: false }))).toBeNull();
  });
  it('counts the worst state', () => {
    expect(
      subscriptionIssue(
        s({
          id: 'x',
          subscriptions: {
            'stream.online': 'pending',
            'stream.offline': 'error',
            'channel.update': 'error',
          },
        }),
      ),
    ).toEqual({ count: 2, state: 'error' });
  });
  it('counts pending when nothing is worse', () => {
    expect(
      subscriptionIssue(
        s({
          id: 'x',
          subscriptions: {
            'stream.online': 'pending',
            'stream.offline': 'enabled',
            'channel.update': 'enabled',
          },
        }),
      ),
    ).toEqual({ count: 1, state: 'pending' });
  });
});

describe('modeLabel', () => {
  it('counts own games for custom mode', () => {
    const cat = { id: '1', name: 'X', boxArtUrl: null };
    expect(modeLabel({ gameMode: 'custom', categories: [cat, cat] })).toEqual({
      key: 'custom',
      count: 2,
      groups: [],
    });
    expect(
      modeLabel({
        gameMode: 'custom',
        categories: [],
        groups: [{ name: 'Soulslikes' }],
      }),
    ).toMatchObject({ groups: ['Soulslikes'] });
    expect(modeLabel({ gameMode: 'any', categories: [cat] })).toEqual({
      key: 'any',
    });
    expect(modeLabel({ gameMode: 'default', categories: [] })).toEqual({
      key: 'default',
    });
  });
});

describe('newlyLive', () => {
  it('ignores the first snapshot and unknown streamers', () => {
    const list = [s({ id: 'a', live: true }), s({ id: 'b', live: true })];
    expect(newlyLive(null, list)).toEqual([]);
    expect(newlyLive(new Map([['a', false]]), list)).toEqual(['a']);
    expect(newlyLive(new Map([['a', true]]), list)).toEqual([]);
  });
});

describe('attentionItems', () => {
  const ov = (p: Partial<Overview> = {}): Overview => ({
    streamers: { total: 0, enabled: 0, live: 0, matching: 0 },
    subscriptions: { active: 0, expected: 0 },
    notifications: { pending: 0, failed: 0, lastError: null },
    recipients: 1,
    lastSync: null,
    ...p,
  });
  const sync = (ok: boolean) => ({
    at: '2026-01-01T00:00:00Z',
    ok,
    active: 0,
    created: 0,
    deleted: 0,
    errors: ok ? [] : ['boom'],
  });
  const withSub = (
    id: string,
    state: 'error' | 'missing' | 'pending',
    p = {},
  ) =>
    s({
      id,
      subscriptions: {
        'stream.online': state,
        'stream.offline': 'enabled',
        'channel.update': 'enabled',
      },
      ...p,
    });

  it('is empty when nothing is wrong', () => {
    expect(
      attentionItems(ov({ lastSync: sync(true) }), [s({ id: 'a' })]),
    ).toEqual([]);
  });

  it('reports failed mails', () => {
    expect(
      attentionItems(
        ov({ notifications: { pending: 0, failed: 2, lastError: null } }),
        [],
      ),
    ).toEqual([{ kind: 'failedMails', count: 2 }]);
  });

  it('reports enabled streamers with error or missing subscriptions', () => {
    expect(
      attentionItems(ov(), [withSub('a', 'error'), withSub('b', 'missing')]),
    ).toEqual([
      {
        kind: 'subscription',
        streamer: { id: 'a', displayName: 'a' },
        types: ['stream.online'],
        state: 'error',
      },
      {
        kind: 'subscription',
        streamer: { id: 'b', displayName: 'b' },
        types: ['stream.online'],
        state: 'missing',
      },
    ]);
  });

  it('hides subscription and sync items for role user', () => {
    const user = ov({
      subscriptions: null,
      lastSync: null,
      notifications: { pending: 0, failed: 1, lastError: null },
    });
    expect(
      attentionItems(user, [withSub('a', 'error'), withSub('b', 'missing')]),
    ).toEqual([{ kind: 'failedMails', count: 1 }]);
  });

  it('keeps subscription and sync items for admins', () => {
    const kinds = attentionItems(ov({ lastSync: sync(false) }), [
      withSub('a', 'error'),
    ]).map((i) => i.kind);
    expect(kinds).toEqual(['syncFailed', 'subscription']);
  });

  it('ignores paused streamers and pending subscriptions', () => {
    expect(
      attentionItems(ov(), [
        withSub('a', 'missing', { enabled: false }),
        withSub('b', 'pending'),
      ]),
    ).toEqual([]);
  });

  it('orders sync, mails, then subscriptions by streamer name', () => {
    const kinds = attentionItems(
      ov({
        notifications: { pending: 0, failed: 1, lastError: null },
        lastSync: sync(false),
      }),
      [withSub('z', 'error'), withSub('m', 'error')],
    ).map((i) =>
      i.kind === 'subscription' ? `${i.kind}:${i.streamer.id}` : i.kind,
    );
    expect(kinds).toEqual([
      'syncFailed',
      'failedMails',
      'subscription:m',
      'subscription:z',
    ]);
  });
});

describe('filterRoster / rosterCounts', () => {
  const list = [
    s({ id: 'a', login: 'alpha', displayName: 'Alpha Wolf', live: true }),
    s({ id: 'b', login: 'bravo', displayName: 'Bravo', enabled: false }),
    s({ id: 'c', login: 'wolfgang', displayName: 'Charlie' }),
  ];
  const ids = (l: Streamer[]) => l.map((x) => x.id);

  it('matches display name', () => {
    expect(ids(filterRoster(list, { q: 'bravo' }))).toEqual(['b']);
  });
  it('matches login', () => {
    expect(ids(filterRoster(list, { q: 'gang' }))).toEqual(['c']);
  });
  it('is case-insensitive', () => {
    expect(ids(filterRoster(list, { q: 'WOLF' }))).toEqual(['a', 'c']);
  });
  it('filters live', () => {
    expect(ids(filterRoster(list, { filter: 'live' }))).toEqual(['a']);
  });
  it('filters active', () => {
    expect(ids(filterRoster(list, { filter: 'active' }))).toEqual(['a', 'c']);
  });
  it('filters paused', () => {
    expect(ids(filterRoster(list, { filter: 'paused' }))).toEqual(['b']);
  });
  it('returns all without q and filter', () => {
    expect(ids(filterRoster(list, {}))).toEqual(['a', 'b', 'c']);
  });
  it('combines search and filter', () => {
    expect(ids(filterRoster(list, { q: 'wolf', filter: 'live' }))).toEqual([
      'a',
    ]);
    expect(filterRoster(list, { q: 'wolf', filter: 'paused' })).toEqual([]);
  });
  it('counts per option', () => {
    expect(rosterCounts(list)).toEqual({
      all: 3,
      live: 1,
      active: 2,
      paused: 1,
    });
  });
});

describe('liveDuration', () => {
  const now = new Date('2026-09-28T21:00:00Z');
  it('floors to whole hours and minutes', () => {
    expect(liveDuration('2026-09-28T18:26:31Z', now)).toEqual({
      hours: 2,
      minutes: 33,
    });
  });
  it('is 0/0 when startedAt is in the future', () => {
    expect(liveDuration('2026-09-28T21:05:00Z', now)).toEqual({
      hours: 0,
      minutes: 0,
    });
  });
});

describe('gameList / search by game', () => {
  const cat = (name: string): Category => ({
    id: name,
    name,
    boxArtUrl: null,
  });
  const defaults = [
    { id: 1, isDefault: true, games: [cat('Chess')] },
    { id: 2, isDefault: false, games: [cat('Elden Ring')] },
  ];
  const custom = s({
    id: 'cu',
    gameMode: 'custom',
    categories: [cat('Zelda')],
  });
  const dflt = s({ id: 'de', gameMode: 'default' });
  const any = s({ id: 'an', gameMode: 'any' });
  const live = s({
    id: 'li',
    gameMode: 'any',
    live: true,
    currentCategory: cat('Minecraft'),
  });
  const list = [custom, dflt, any, live];
  const ids = (l: Streamer[]) => l.map((x) => x.id);

  it('lists custom categories', () => {
    expect(gameList(custom, [])).toEqual(['Zelda']);
  });
  it('lists defaults for default mode', () => {
    expect(gameList(dflt, defaults)).toEqual(['Chess']);
  });
  it('lists nothing for any mode', () => {
    expect(gameList(any, defaults)).toEqual([]);
  });
  it('search matches the current game', () => {
    expect(ids(filterRoster(list, { q: ' minecraft ' }))).toEqual(['li']);
  });
  it('search matches a custom-list game', () => {
    expect(ids(filterRoster(list, { q: 'zel' }))).toEqual(['cu']);
  });
  it('search matches a default-list game when defaults are passed', () => {
    expect(ids(filterRoster(list, { q: 'chess' }, defaults))).toEqual(['de']);
    expect(filterRoster(list, { q: 'chess' })).toEqual([]);
  });
  const grouped = s({
    id: 'gr',
    gameMode: 'custom',
    categories: [],
    groups: [{ id: 2, name: 'Soulslikes' }],
  });
  it('search matches a group name', () => {
    expect(ids(filterRoster([grouped, any], { q: 'soulsl' }))).toEqual(['gr']);
  });
  it('search matches a game only present via a group', () => {
    expect(ids(filterRoster([grouped, any], { q: 'elden' }, defaults))).toEqual(
      ['gr'],
    );
    expect(gameList(grouped, defaults)).toEqual(['Elden Ring']);
  });
  it('search ignores group names outside custom mode', () => {
    const stale = s({
      id: 'st',
      gameMode: 'any',
      groups: [{ id: 2, name: 'Soulslikes' }],
    });
    expect(filterRoster([stale], { q: 'soulsl' }, defaults)).toEqual([]);
  });
  it('default mode lists default-group games only', () => {
    expect(gameList(dflt, defaults)).toEqual(['Chess']);
  });
  it('search still matches name and login', () => {
    expect(ids(filterRoster(list, { q: 'cu' }, defaults))).toEqual(['cu']);
  });
});
