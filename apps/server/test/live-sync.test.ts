import { afterEach, beforeEach, expect, test } from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import { liveState, mailOutbox } from '../src/db/schema.ts';
import { createBus } from '../src/events/bus.ts';
import { createLiveSync } from '../src/notify/live-sync.ts';
import type { BusEvent } from '../src/shared/events.ts';
import { applyEvent, type EventsubDeps } from '../src/twitch/eventsub.ts';
import type { TwitchStream } from '../src/twitch/helix.ts';
import { createFakeClock, type FakeClock } from './helpers/clock.ts';
import { createTestDb } from './helpers/db.ts';
import {
  ELDEN_RING,
  JUST_CHATTING,
  seedStreamer,
  seedUser,
} from './helpers/seed.ts';

let handle: DbHandle;
let streams: TwitchStream[];
let events: BusEvent[];
let requested: string[][];
let clock: FakeClock;

beforeEach(() => {
  handle = createTestDb();
  streams = [];
  events = [];
  requested = [];
  clock = createFakeClock();
});
afterEach(() => handle.close());

function sync() {
  const bus = createBus();
  bus.subscribe((e) => events.push(e));
  return createLiveSync({
    db: handle.db,
    clock,
    bus,
    timeZone: 'Europe/Berlin',
    helix: {
      getStreams: async (ids) => {
        requested.push([...ids]);
        return streams.filter((s) => ids.includes(s.userId));
      },
    },
  });
}

test('queues for a live matching streamer once, clears offline ones', async () => {
  seedStreamer(handle.db, { id: 'b1', mode: 'custom', games: [ELDEN_RING] });
  seedStreamer(handle.db, { id: 'b2', mode: 'any' });
  seedStreamer(handle.db, { id: 'b3', mode: 'any', enabled: false });
  streams = [
    {
      id: 's1',
      userId: 'b1',
      userLogin: 'b1',
      userName: 'B1',
      gameId: ELDEN_RING.id,
      gameName: ELDEN_RING.name,
      title: 'live',
      startedAt: '2026-01-15T17:00:00Z',
    },
  ];
  const run = sync();
  await run();
  expect(requested[0]?.sort()).toEqual(['b1', 'b2']);
  expect(handle.db.select().from(mailOutbox).all()).toHaveLength(1);
  const b1 = handle.db
    .select()
    .from(liveState)
    .all()
    .find((r) => r.broadcasterId === 'b1');
  expect(b1).toMatchObject({
    streamId: 's1',
    categoryId: ELDEN_RING.id,
    title: 'live',
    startedAt: Date.parse('2026-01-15T17:00:00Z'),
  });
  const liveEvents = events.filter((e) => e.type === 'live-state').length;
  expect(liveEvents).toBeGreaterThan(0);

  await run();
  expect(handle.db.select().from(mailOutbox).all()).toHaveLength(1);
  expect(events.filter((e) => e.type === 'live-state').length).toBe(liveEvents);

  streams = [];
  await run();
  const after = handle.db
    .select()
    .from(liveState)
    .all()
    .find((r) => r.broadcasterId === 'b1');
  expect(after?.streamId).toBeNull();
});

const LIVE: TwitchStream = {
  id: 's1',
  userId: 'b1',
  userLogin: 'b1',
  userName: 'B1',
  gameId: ELDEN_RING.id,
  gameName: ELDEN_RING.name,
  title: 'live',
  startedAt: '2026-01-15T17:00:00Z',
};
const OTHER_GAME = JUST_CHATTING;

function eventDeps(): EventsubDeps {
  return {
    db: handle.db,
    clock,
    bus: createBus(),
    timeZone: 'Europe/Berlin',
    helix: {
      getChannels: async (ids) =>
        ids.map((id) => ({
          broadcasterId: id,
          broadcasterLogin: id,
          broadcasterName: id,
          gameId: OTHER_GAME.id,
          gameName: OTHER_GAME.name,
          title: 't',
        })),
    },
  };
}
const update = (game: { id: string; name: string }) => ({
  broadcaster_user_id: 'b1',
  category_id: game.id,
  category_name: game.name,
  title: 't',
});
const mails = () => handle.db.select().from(mailOutbox).all();
const row = () =>
  handle.db
    .select()
    .from(liveState)
    .all()
    .find((r) => r.broadcasterId === 'b1');

test('lagging Helix right after stream.online does not clear the stream', async () => {
  seedStreamer(handle.db, { id: 'b1', mode: 'custom', games: [ELDEN_RING] });
  const ev = eventDeps();
  await applyEvent(ev, 'stream.online', {
    id: 's1',
    broadcaster_user_id: 'b1',
  });
  clock.advance(60_000);
  streams = [];
  await sync()();
  expect(row()?.streamId).toBe('s1');
  await applyEvent(ev, 'channel.update', update(ELDEN_RING));
  expect(mails()).toHaveLength(1);
});

test('lagging Helix right after stream.offline does not restore the stream', async () => {
  seedStreamer(handle.db, { id: 'b1', mode: 'custom', games: [ELDEN_RING] });
  const ev = eventDeps();
  await applyEvent(ev, 'stream.online', {
    id: 's1',
    broadcaster_user_id: 'b1',
  });
  await applyEvent(ev, 'stream.offline', { broadcaster_user_id: 'b1' });
  clock.advance(60_000);
  streams = [{ ...LIVE, gameId: OTHER_GAME.id, gameName: OTHER_GAME.name }];
  await sync()();
  expect(row()?.streamId).toBeNull();
  await applyEvent(ev, 'channel.update', update(ELDEN_RING));
  expect(mails()).toHaveLength(0);
});

test('live sync applies again once the event grace period has passed', async () => {
  seedStreamer(handle.db, { id: 'b1', mode: 'custom', games: [ELDEN_RING] });
  const ev = eventDeps();
  await applyEvent(ev, 'stream.offline', { broadcaster_user_id: 'b1' });
  streams = [LIVE];
  clock.advance(4 * 60_000);
  await sync()();
  expect(row()?.streamId).toBeNull();
  clock.advance(60_001);
  await sync()();
  expect(row()?.streamId).toBe('s1');
  expect(mails()).toHaveLength(1);
});

test('live sync marks paused streamers offline', async () => {
  seedStreamer(handle.db, { id: 'b1', mode: 'any', enabled: false });
  handle.db
    .insert(liveState)
    .values({ broadcasterId: 'b1', streamId: 's1', updatedAt: 0 })
    .run();
  await sync()();
  expect(row()?.streamId).toBeNull();
  expect(events.some((e) => e.type === 'live-state')).toBe(true);
});

test('polls broadcasters enabled by at least one account', async () => {
  const tom = seedUser(handle.db, 'tom');
  seedStreamer(handle.db, { id: 'b1', enabled: false });
  seedStreamer(handle.db, { id: 'b1', ownerId: tom });
  seedStreamer(handle.db, { id: 'b2', enabled: false });
  seedStreamer(handle.db, { id: 'b2', enabled: false, ownerId: tom });
  await sync()();
  expect(requested[0]).toEqual(['b1']);
});
