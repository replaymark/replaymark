import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import {
  gameGroupCategories,
  gameGroups,
  liveState,
  mailOutbox,
  streamerGroups,
} from '../src/db/schema.ts';
import { setMailLanguage, setRecipients } from '../src/db/settings.ts';
import { createBus } from '../src/events/bus.ts';
import { categoryMatches } from '../src/notify/match.ts';
import type { BusEvent } from '../src/shared/events.ts';
import { applyEvent, type EventsubDeps } from '../src/twitch/eventsub.ts';
import type { TwitchChannel } from '../src/twitch/helix.ts';
import { createFakeClock } from './helpers/clock.ts';
import { createTestDb } from './helpers/db.ts';
import {
  ELDEN_RING,
  JUST_CHATTING,
  MINECRAFT,
  OWNER_ID,
  seedCategory,
  seedDefaultGames,
  seedStreamer,
  seedUser,
} from './helpers/seed.ts';

let handle: DbHandle;
let deps: EventsubDeps;
let channel: { gameId: string; gameName: string; title: string };
let events: BusEvent[];
let wakes: number;

beforeEach(() => {
  handle = createTestDb();
  events = [];
  wakes = 0;
  channel = { gameId: '', gameName: '', title: '' };
  const bus = createBus();
  bus.subscribe((e) => events.push(e));
  deps = {
    db: handle.db,
    clock: createFakeClock(),
    bus,
    timeZone: 'Europe/Berlin',
    onQueued: () => {
      wakes++;
    },
    helix: {
      getChannels: async (ids: readonly string[]): Promise<TwitchChannel[]> =>
        ids.map((id) => ({
          broadcasterId: id,
          broadcasterLogin: 'x',
          broadcasterName: 'x',
          ...channel,
        })),
    },
  };
  setRecipients(handle.db, 1, ['me@example.test']);
});
afterEach(() => handle.close());

const B = '1001';
const online = (streamId: string) =>
  applyEvent(deps, 'stream.online', {
    id: streamId,
    broadcaster_user_id: B,
    started_at: '2026-01-15T17:00:00Z',
  });
const update = (c: { id: string; name: string }, title = 'title') =>
  applyEvent(deps, 'channel.update', {
    broadcaster_user_id: B,
    category_id: c.id,
    category_name: c.name,
    title,
  });
const offline = () =>
  applyEvent(deps, 'stream.offline', { broadcaster_user_id: B });
const outbox = () => handle.db.select().from(mailOutbox).all();
const playing = (c: { id: string; name: string }, title = 'title') => {
  channel = { gameId: c.id, gameName: c.name, title };
};

describe('notifications', () => {
  test('online in a matching game queues exactly one mail', async () => {
    seedStreamer(handle.db, {
      id: B,
      login: 'streamer',
      displayName: 'Streamer',
      mode: 'custom',
      games: [ELDEN_RING],
    });
    playing(ELDEN_RING, 'Boss run');
    await online('s1');
    const rows = outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      streamId: 's1',
      categoryId: ELDEN_RING.id,
      broadcasterId: B,
      status: 'pending',
      attempts: 0,
      sentAt: null,
    });
    expect(rows[0]?.updatedAt).toBe(rows[0]?.createdAt);
    const payload = JSON.parse(rows[0]?.payload ?? '{}');
    expect(payload).toMatchObject({
      subject: '🔴 Streamer spielt jetzt Elden Ring',
      recipients: ['me@example.test'],
      login: 'streamer',
      displayName: 'Streamer',
      gameName: 'Elden Ring',
      title: 'Boss run',
    });
    expect(payload.html).toContain('https://twitch.tv/streamer');
    expect(wakes).toBe(1);
    expect(events.some((e) => e.type === 'notification')).toBe(true);
    const live = events.filter((e) => e.type === 'live-state');
    expect(live.at(-1)?.payload).toMatchObject({
      live: true,
      streamId: 's1',
      categoryId: ELDEN_RING.id,
    });
  });

  test('Just Chatting then switch to matching game notifies once, at the switch', async () => {
    seedStreamer(handle.db, { id: B, mode: 'custom', games: [ELDEN_RING] });
    playing(JUST_CHATTING);
    await online('s1');
    expect(outbox()).toHaveLength(0);
    await update(ELDEN_RING);
    expect(outbox()).toHaveLength(1);
    await update(ELDEN_RING, 'new title');
    expect(outbox()).toHaveLength(1);
  });

  test('channel.update while offline queues nothing', async () => {
    seedStreamer(handle.db, { id: B, mode: 'custom', games: [ELDEN_RING] });
    await update(ELDEN_RING);
    expect(outbox()).toHaveLength(0);
    const row = handle.db.select().from(liveState).get();
    expect(row?.categoryId).toBe(ELDEN_RING.id);
    expect(row?.streamId).toBeNull();
  });

  test('away and back in the same stream stays at one mail', async () => {
    seedStreamer(handle.db, { id: B, mode: 'custom', games: [ELDEN_RING] });
    playing(ELDEN_RING);
    await online('s1');
    await update(JUST_CHATTING);
    await update(ELDEN_RING);
    expect(outbox()).toHaveLength(1);
  });

  test('new stream id in the same game queues a second mail', async () => {
    seedStreamer(handle.db, { id: B, mode: 'custom', games: [ELDEN_RING] });
    playing(ELDEN_RING);
    await online('s1');
    await offline();
    expect(handle.db.select().from(liveState).get()?.streamId).toBeNull();
    await online('s2');
    expect(outbox()).toHaveLength(2);
  });

  test('mode any notifies for any category', async () => {
    seedStreamer(handle.db, { id: B, mode: 'any' });
    playing(JUST_CHATTING);
    await online('s1');
    expect(outbox()).toHaveLength(1);
  });

  test('mode default uses default_games', async () => {
    seedStreamer(handle.db, { id: B, mode: 'default', games: [MINECRAFT] });
    seedDefaultGames(handle.db, [ELDEN_RING]);
    playing(MINECRAFT);
    await online('s1');
    expect(outbox()).toHaveLength(0);
    await update(ELDEN_RING);
    expect(outbox()).toHaveLength(1);
  });

  test('paused streamer gets no mail', async () => {
    seedStreamer(handle.db, { id: B, mode: 'any', enabled: false });
    playing(ELDEN_RING);
    await online('s1');
    expect(outbox()).toHaveLength(0);
  });

  test('English mail language and box art from categories', async () => {
    setMailLanguage(handle.db, 1, 'en');
    seedCategory(handle.db, ELDEN_RING, 'https://img.test/{width}x{height}');
    seedStreamer(handle.db, { id: B, displayName: 'S', mode: 'any' });
    playing(ELDEN_RING);
    await online('s1');
    const payload = JSON.parse(outbox()[0]?.payload ?? '{}');
    expect(payload.subject).toBe('🔴 S is now playing Elden Ring');
    expect(payload.boxArtUrl).toBe('https://img.test/{width}x{height}');
    expect(payload.html).toContain('https://img.test/144x192');
  });
});

describe('two accounts', () => {
  test('separate lists: only the following account gets a mail', async () => {
    const tom = seedUser(handle.db, 'tom');
    setRecipients(handle.db, tom, ['tom@y.test']);
    seedStreamer(handle.db, { id: B, login: 'gronkh', mode: 'any' });
    playing(ELDEN_RING);
    await online('s1');
    const rows = outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ownerId).toBe(OWNER_ID);
    expect(JSON.parse(rows[0]?.payload ?? '{}').recipients).toEqual([
      'me@example.test',
    ]);
    expect(rows.some((r) => r.ownerId === tom)).toBe(false);
  });

  test('same streamer: one mail per account with own recipients and language', async () => {
    const tom = seedUser(handle.db, 'tom');
    setRecipients(handle.db, tom, ['tom@y.test']);
    setMailLanguage(handle.db, tom, 'en');
    seedStreamer(handle.db, { id: B, login: 'gronkh', mode: 'any' });
    seedStreamer(handle.db, {
      id: B,
      login: 'gronkh',
      mode: 'custom',
      games: [ELDEN_RING],
      ownerId: tom,
    });
    playing(ELDEN_RING);
    await online('s1');
    const rows = outbox();
    expect(rows).toHaveLength(2);
    const mine = rows.find((r) => r.ownerId === OWNER_ID);
    const his = rows.find((r) => r.ownerId === tom);
    const mp = JSON.parse(mine?.payload ?? '{}');
    const hp = JSON.parse(his?.payload ?? '{}');
    expect(mp.recipients).toEqual(['me@example.test']);
    expect(mp.subject).toBe('🔴 gronkh spielt jetzt Elden Ring');
    expect(hp.recipients).toEqual(['tom@y.test']);
    expect(hp.subject).toBe('🔴 gronkh is now playing Elden Ring');
    const notes = events.filter((e) => e.type === 'notification');
    expect(notes.map((e) => e.payload)).toEqual([
      expect.objectContaining({ ownerId: OWNER_ID, broadcasterId: B }),
      expect.objectContaining({ ownerId: tom, broadcasterId: B }),
    ]);
    expect(wakes).toBe(1);
    await online('s1');
    expect(outbox()).toHaveLength(2);
  });

  test('only matching or active accounts get a mail', async () => {
    const tom = seedUser(handle.db, 'tom');
    seedStreamer(handle.db, { id: B, mode: 'any', enabled: false });
    seedStreamer(handle.db, {
      id: B,
      mode: 'custom',
      games: [MINECRAFT],
      ownerId: tom,
    });
    playing(ELDEN_RING);
    await online('s1');
    expect(outbox()).toHaveLength(0);
    seedStreamer(handle.db, { id: '2002', mode: 'any', ownerId: tom });
    expect(categoryMatches(handle.db, '2002', ELDEN_RING.id, OWNER_ID)).toBe(
      false,
    );
    expect(categoryMatches(handle.db, '2002', ELDEN_RING.id, tom)).toBe(true);
  });
});

describe('custom via group end to end', () => {
  test('online in a game of an assigned group queues one mail', async () => {
    seedStreamer(handle.db, { id: B, mode: 'custom' });
    seedCategory(handle.db, ELDEN_RING);
    const { id } = handle.db
      .insert(gameGroups)
      .values({ ownerId: OWNER_ID, name: 'Souls' })
      .returning({ id: gameGroups.id })
      .get();
    handle.db
      .insert(gameGroupCategories)
      .values({ groupId: id, categoryId: ELDEN_RING.id })
      .run();
    handle.db
      .insert(streamerGroups)
      .values({ ownerId: OWNER_ID, userId: B, groupId: id })
      .run();
    playing(ELDEN_RING);
    await online('s1');
    expect(outbox()).toHaveLength(1);
  });
});

describe('categoryMatches', () => {
  test('unknown streamer never matches', () => {
    expect(categoryMatches(handle.db, 'nope', ELDEN_RING.id, OWNER_ID)).toBe(
      false,
    );
  });

  const makeGroup = (
    name: string,
    games: { id: string; name: string }[],
    assignTo?: string,
  ): number => {
    const { id } = handle.db
      .insert(gameGroups)
      .values({ ownerId: OWNER_ID, name })
      .returning({ id: gameGroups.id })
      .get();
    addToGroup(id, games);
    if (assignTo)
      handle.db
        .insert(streamerGroups)
        .values({ ownerId: OWNER_ID, userId: assignTo, groupId: id })
        .run();
    return id;
  };
  const addToGroup = (
    groupId: number,
    games: { id: string; name: string }[],
  ): void => {
    for (const g of games) {
      seedCategory(handle.db, g);
      handle.db
        .insert(gameGroupCategories)
        .values({ groupId, categoryId: g.id })
        .run();
    }
  };

  test('custom matches via an assigned group only', () => {
    seedStreamer(handle.db, { id: B, mode: 'custom' });
    makeGroup('Souls', [ELDEN_RING], B);
    expect(categoryMatches(handle.db, B, ELDEN_RING.id, OWNER_ID)).toBe(true);
    expect(categoryMatches(handle.db, B, MINECRAFT.id, OWNER_ID)).toBe(false);
  });

  test('custom ignores groups that are not assigned', () => {
    seedStreamer(handle.db, { id: B, mode: 'custom' });
    makeGroup('Souls', [ELDEN_RING]);
    expect(categoryMatches(handle.db, B, ELDEN_RING.id, OWNER_ID)).toBe(false);
  });

  test('custom matches via a single game', () => {
    seedStreamer(handle.db, { id: B, mode: 'custom', games: [MINECRAFT] });
    expect(categoryMatches(handle.db, B, MINECRAFT.id, OWNER_ID)).toBe(true);
    expect(categoryMatches(handle.db, B, ELDEN_RING.id, OWNER_ID)).toBe(false);
  });

  test('a group edit applies to the next check', () => {
    seedStreamer(handle.db, { id: B, mode: 'custom' });
    const id = makeGroup('Souls', [ELDEN_RING], B);
    expect(categoryMatches(handle.db, B, MINECRAFT.id, OWNER_ID)).toBe(false);
    addToGroup(id, [MINECRAFT]);
    expect(categoryMatches(handle.db, B, MINECRAFT.id, OWNER_ID)).toBe(true);
  });

  test('default matches the default group games only', () => {
    seedDefaultGames(handle.db, [JUST_CHATTING]);
    seedStreamer(handle.db, { id: B, mode: 'default' });
    makeGroup('Souls', [ELDEN_RING], B);
    expect(categoryMatches(handle.db, B, JUST_CHATTING.id, OWNER_ID)).toBe(
      true,
    );
    expect(categoryMatches(handle.db, B, ELDEN_RING.id, OWNER_ID)).toBe(false);
  });

  test('a paused streamer never matches', () => {
    seedDefaultGames(handle.db, [JUST_CHATTING]);
    seedStreamer(handle.db, {
      id: B,
      mode: 'custom',
      enabled: false,
      games: [MINECRAFT],
    });
    makeGroup('Souls', [ELDEN_RING], B);
    expect(categoryMatches(handle.db, B, MINECRAFT.id, OWNER_ID)).toBe(false);
    expect(categoryMatches(handle.db, B, ELDEN_RING.id, OWNER_ID)).toBe(false);
  });
});
