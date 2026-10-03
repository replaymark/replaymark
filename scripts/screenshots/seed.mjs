import { openDb } from '../../apps/server/src/db/client.ts';
import {
  categories,
  categorySegments,
  follows,
  gameGroupCategories,
  gameGroups,
  liveState,
  mailOutbox,
  streamerGames,
  streamerGroups,
  streamers,
  streams,
  subscriptions,
  userRecipients,
  users,
} from '../../apps/server/src/db/schema.ts';
import { setMeta, setRecipients } from '../../apps/server/src/db/settings.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const art = (id) =>
  `https://static-cdn.jtvnw.net/ttv-boxart/${id}_IGDB-{width}x{height}.jpg`;

const GAMES = {
  elden: { id: '512953', name: 'Elden Ring' },
  ds3: { id: '490292', name: 'Dark Souls III' },
  acnh: { id: '509538', name: 'Animal Crossing: New Horizons' },
  minecraft: { id: '27471', name: 'Minecraft' },
  phasmo: { id: '518184', name: 'Phasmophobia' },
  dbd: { id: '491487', name: 'Dead by Daylight' },
  chatting: { id: '509658', name: 'Just Chatting' },
};

// Fictional channels; avatars stay null so the UI shows initials.
const STREAMERS = [
  { id: '90000001', login: 'quietfox', name: 'QuietFox' },
  { id: '90000002', login: 'pixelmoth', name: 'PixelMoth' },
  { id: '90000003', login: 'lanternlane', name: 'LanternLane' },
  { id: '90000004', login: 'cobaltcrow', name: 'CobaltCrow' },
  { id: '90000005', login: 'mossandmilk', name: 'MossAndMilk' },
  { id: '90000006', login: 'halfpastnine', name: 'HalfPastNine' },
  { id: '90000007', login: 'driftwoodtv', name: 'DriftwoodTV' },
  { id: '90000008', login: 'saltandember', name: 'SaltAndEmber' },
];

const TITLES = {
  elden: [
    'Shadow of the Erdtree, no summons',
    'Blind run, boss rush night',
    'Level 1 challenge, attempt 14',
  ],
  ds3: ['Lothric at last', 'Pontiff again, send help'],
  acnh: ['Island makeover', 'Cozy island morning, fishing for legends'],
  minecraft: ['Building the village hall', 'Redstone experiments'],
  phasmo: ['Ghost hunting with chat', 'Nightmare difficulty, no flashlight'],
  dbd: ['Survivor mains only'],
  chatting: ['Catching up, ask me anything', 'Chill hangout'],
};

/** Per streamer: [game key list per past stream]; used to build streams and segments. */
const HISTORY = {
  quietfox: [['elden'], ['elden', 'chatting'], ['ds3', 'elden'], ['elden']],
  pixelmoth: [['acnh'], ['acnh', 'minecraft'], ['minecraft']],
  lanternlane: [['phasmo'], ['phasmo', 'dbd'], ['chatting', 'phasmo']],
  cobaltcrow: [['ds3'], ['elden', 'dbd'], ['ds3', 'chatting']],
  mossandmilk: [['acnh'], ['acnh', 'minecraft']],
  halfpastnine: [['chatting', 'minecraft'], ['minecraft']],
  driftwoodtv: [['minecraft'], ['elden']],
  saltandember: [['dbd']],
};

/** Deterministic pseudo-random so every run produces the same demo. */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function seedDemo(file, now) {
  const handle = openDb(file);
  const { db, sqlite } = handle;
  const rand = rng(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const admin = db
    .select()
    .from(users)
    .all()
    .find((u) => u.role === 'admin');
  if (!admin) throw new Error('admin account missing');
  const adminId = admin.id;
  sqlite
    .prepare('update users set mail_language = ?, created_at = ? where id = ?')
    .run('en', now - 45 * DAY, adminId);
  setRecipients(db, adminId, [admin.email, 'alerts@example.org']);

  const second = db
    .insert(users)
    .values({
      username: 'sam',
      email: 'sam@example.org',
      role: 'user',
      mailLanguage: 'en',
      createdAt: now - 20 * DAY,
    })
    .returning({ id: users.id })
    .get().id;
  db.insert(userRecipients)
    .values({ userId: second, email: 'sam@example.org' })
    .run();

  for (const g of Object.values(GAMES)) {
    db.insert(categories)
      .values({ categoryId: g.id, name: g.name, boxArtUrl: art(g.id) })
      .onConflictDoNothing()
      .run();
  }

  const group = (ownerId, name, isDefault, keys) => {
    let row = db
      .select()
      .from(gameGroups)
      .all()
      .filter((g) => g.ownerId === ownerId)
      .find((g) => g.isDefault === isDefault && (isDefault || g.name === name));
    if (!row) {
      row = db
        .insert(gameGroups)
        .values({ ownerId, name, isDefault, createdAt: now - 30 * DAY })
        .returning()
        .get();
    }
    for (const k of keys) {
      db.insert(gameGroupCategories)
        .values({ groupId: row.id, categoryId: GAMES[k].id })
        .onConflictDoNothing()
        .run();
    }
    return row.id;
  };
  group(adminId, 'Default', true, ['elden', 'acnh', 'minecraft']);
  const soulslikes = group(adminId, 'Soulslikes', false, ['elden', 'ds3']);
  const cozy = group(adminId, 'Cozy', false, ['acnh', 'minecraft']);
  const horror = group(adminId, 'Horror', false, ['phasmo', 'dbd']);
  group(second, 'Default', true, ['elden', 'phasmo']);

  const follow = (ownerId, s, mode, enabled = true) => {
    db.insert(streamers)
      .values({
        userId: s.id,
        login: s.login,
        displayName: s.name,
        avatarUrl: null,
        createdAt: now - 40 * DAY,
      })
      .onConflictDoNothing()
      .run();
    db.insert(follows)
      .values({
        ownerId,
        broadcasterId: s.id,
        gameMode: mode,
        enabled,
        createdAt: now - 30 * DAY,
      })
      .run();
  };
  const by = Object.fromEntries(STREAMERS.map((s) => [s.login, s]));
  const assign = (s, groupIds, ownGames = []) => {
    for (const groupId of groupIds)
      db.insert(streamerGroups)
        .values({ ownerId: adminId, userId: s.id, groupId })
        .run();
    for (const k of ownGames)
      db.insert(streamerGames)
        .values({ ownerId: adminId, userId: s.id, categoryId: GAMES[k].id })
        .run();
  };
  follow(adminId, by.quietfox, 'custom');
  assign(by.quietfox, [soulslikes]);
  follow(adminId, by.pixelmoth, 'custom');
  assign(by.pixelmoth, [cozy]);
  follow(adminId, by.lanternlane, 'custom');
  assign(by.lanternlane, [horror], ['chatting']);
  follow(adminId, by.cobaltcrow, 'custom');
  assign(by.cobaltcrow, [soulslikes, horror]);
  follow(adminId, by.mossandmilk, 'custom');
  assign(by.mossandmilk, [cozy]);
  follow(adminId, by.halfpastnine, 'any');
  follow(adminId, by.driftwoodtv, 'default');
  follow(adminId, by.saltandember, 'default', false);
  follow(second, by.quietfox, 'default');
  follow(second, by.driftwoodtv, 'any');

  // Past streams over the last six days, plus three live ones.
  let streamSeq = 400000000;
  const nextStreamId = () => {
    streamSeq += 137;
    return String(streamSeq);
  };
  const live = { quietfox: 'elden', pixelmoth: 'acnh', lanternlane: 'phasmo' };
  const liveSince = { quietfox: 95, pixelmoth: 42, lanternlane: 18 };
  let day = 0;
  for (const s of STREAMERS) {
    for (const keys of HISTORY[s.login]) {
      day += 1;
      const startedAt = now - ((day % 6) + 0.4 + rand() * 0.5) * DAY;
      let cursor = startedAt;
      const segments = [];
      for (const k of keys) {
        const len = (50 + Math.floor(rand() * 110)) * MIN;
        segments.push({ k, from: cursor, to: cursor + len });
        cursor += len;
      }
      const streamId = nextStreamId();
      const vodId = String(2200000000 + streamSeq);
      db.insert(streams)
        .values({
          streamId,
          broadcasterId: s.id,
          startedAt,
          endedAt: cursor,
          vodId,
          vodCreatedAt: startedAt + 20_000,
          vodDurationS: Math.floor((cursor - startedAt) / 1000),
          vodState: 'available',
          vodCheckedAt: cursor + 10 * MIN,
        })
        .run();
      for (const seg of segments) {
        db.insert(categorySegments)
          .values({
            streamId,
            broadcasterId: s.id,
            categoryId: GAMES[seg.k].id,
            categoryName: GAMES[seg.k].name,
            startedAt: seg.from,
            endedAt: seg.to,
          })
          .run();
      }
    }
    const k = live[s.login];
    if (k) {
      const startedAt = now - liveSince[s.login] * MIN;
      const streamId = nextStreamId();
      const title = pick(TITLES[k]);
      db.insert(streams)
        .values({
          streamId,
          broadcasterId: s.id,
          startedAt,
          vodState: 'pending',
        })
        .run();
      db.insert(categorySegments)
        .values({
          streamId,
          broadcasterId: s.id,
          categoryId: GAMES[k].id,
          categoryName: GAMES[k].name,
          startedAt,
        })
        .run();
      db.insert(liveState)
        .values({
          broadcasterId: s.id,
          streamId,
          categoryId: GAMES[k].id,
          categoryName: GAMES[k].name,
          title,
          startedAt,
          updatedAt: now,
          eventAt: now,
        })
        .run();
      s.liveStream = { streamId, k, title, startedAt };
    }
  }

  // Healthy sync state: every followed streamer has the three subscriptions.
  const enabled = new Set(
    db
      .select()
      .from(follows)
      .all()
      .filter((f) => f.enabled)
      .map((f) => f.broadcasterId),
  );
  let subN = 0;
  for (const id of enabled) {
    for (const [type, version] of [
      ['stream.online', '1'],
      ['stream.offline', '1'],
      ['channel.update', '2'],
    ]) {
      db.insert(subscriptions)
        .values({
          twitchSubId: `demo-sub-${++subN}`,
          type,
          version,
          broadcasterId: id,
          status: 'enabled',
          createdAt: now - 10 * DAY,
          updatedAt: now - 2 * HOUR,
        })
        .run();
    }
  }
  setMeta(db, 'last_sync', {
    at: now - 25 * MIN,
    ok: true,
    active: subN,
    created: 0,
    deleted: 0,
    errors: [],
  });

  // Mail history. Failed mails belong to the second account so the admin
  // overview shows no attention item.
  const mail = (
    ownerId,
    s,
    k,
    title,
    minutesAgo,
    status,
    extra = {},
    streamId = `hist-${ownerId}-${s.id}-${minutesAgo}`,
  ) => {
    const gm = GAMES[k];
    const createdAt = now - minutesAgo * MIN;
    const payload = {
      subject: `${s.name} is now playing ${gm.name}`,
      text: '',
      html: '',
      recipients: ['alerts@example.org'],
      login: s.login,
      displayName: s.name,
      gameName: gm.name,
      boxArtUrl: art(gm.id),
      title,
    };
    db.insert(mailOutbox)
      .values({
        ownerId,
        streamId,
        broadcasterId: s.id,
        categoryId: gm.id,
        payload: JSON.stringify(payload),
        attempts: status === 'sent' ? 1 : 0,
        nextAttemptAt: createdAt,
        status,
        createdAt,
        updatedAt: createdAt,
        sentAt: status === 'sent' ? createdAt + 4000 : null,
        ...extra,
      })
      .run();
  };
  const sentRows = [
    ['quietfox', 'elden', 0.3],
    ['pixelmoth', 'acnh', 0.7],
    ['lanternlane', 'phasmo', 1.1],
    ['cobaltcrow', 'ds3', 5],
    ['quietfox', 'elden', 26],
    ['mossandmilk', 'acnh', 31],
    ['lanternlane', 'dbd', 50],
    ['cobaltcrow', 'dbd', 74],
    ['pixelmoth', 'minecraft', 98],
    ['quietfox', 'ds3', 120],
  ];
  // The three live streams were announced already.
  const liveSent = ['quietfox', 'pixelmoth', 'lanternlane'];
  for (const [login, k, hours] of sentRows) {
    const s = by[login];
    const t =
      liveSent.includes(login) && hours < 2
        ? s.liveStream.title
        : pick(TITLES[k]);
    const isLive = liveSent.includes(login) && hours < 2;
    mail(
      adminId,
      s,
      k,
      t,
      Math.round(hours * 60) + 5,
      'sent',
      {},
      isLive ? s.liveStream.streamId : undefined,
    );
  }
  mail(adminId, by.mossandmilk, 'acnh', pick(TITLES.acnh), 12, 'pending', {
    nextAttemptAt: now + 30 * MIN,
    attempts: 1,
  });
  mail(second, by.quietfox, 'elden', pick(TITLES.elden), 60 * 7, 'failed', {
    attempts: 5,
    lastError: 'connect ECONNREFUSED smtp.example.org:587',
    sentAt: null,
  });
  mail(
    second,
    by.driftwoodtv,
    'minecraft',
    pick(TITLES.minecraft),
    60 * 29,
    'failed',
    {
      attempts: 5,
      lastError: 'connect ECONNREFUSED smtp.example.org:587',
    },
  );

  const n = db.select().from(streamers).all().length;
  handle.close();
  return { streamers: n, adminId };
}
