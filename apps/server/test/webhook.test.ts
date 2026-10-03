import { eq } from 'drizzle-orm';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  test,
  vi,
} from 'vitest';
import type { DbHandle } from '../src/db/client.ts';
import { eventsubInbox, subscriptions } from '../src/db/schema.ts';
import { createPublicApp } from '../src/http/public.ts';
import { createLogger } from '../src/log.ts';
import { createFakeClock, type FakeClock } from './helpers/clock.ts';
import { createTestDb } from './helpers/db.ts';
import {
  type SignedMessage,
  signedMessage,
  TEST_WEBHOOK_SECRET,
} from './helpers/eventsub.ts';

const CALLBACK = 'https://example.test/webhook';

let handle: DbHandle;
let clock: FakeClock;
let wake: Mock<() => void>;
let request: Mock<(reason: string) => void>;
let logs: string[];
let publish: Mock<(type: string, payload: unknown) => void>;
let app: ReturnType<typeof createPublicApp>;

beforeEach(() => {
  handle = createTestDb();
  clock = createFakeClock();
  wake = vi.fn<() => void>();
  request = vi.fn<(reason: string) => void>();
  logs = [];
  publish = vi.fn<(type: string, payload: unknown) => void>();
  app = createPublicApp({
    db: handle.db,
    clock,
    logger: createLogger({ level: 'debug', write: (l) => logs.push(l) }),
    bus: { publish },
    webhookSecret: TEST_WEBHOOK_SECRET,
    callbackUrl: CALLBACK,
    inboxWorker: { wake },
    reconciler: { request },
  });
});

afterEach(() => handle.close());

const post = (m: SignedMessage) =>
  app.request('/webhook', { method: 'POST', headers: m.headers, body: m.body });
const rows = () => handle.db.select().from(eventsubInbox).all();

const notification = (
  extra: Partial<Parameters<typeof signedMessage>[0]> = {},
) =>
  signedMessage({
    type: 'notification',
    payload: {
      subscription: { id: 'sub-1', type: 'stream.online' },
      event: { broadcaster_user_id: '42' },
    },
    timestamp: clock.now(),
    ...extra,
  });

describe('POST /webhook', () => {
  test('valid notification: 204, inbox row, worker woken', async () => {
    const m = notification({ messageId: 'msg-1' });
    const res = await post(m);
    expect(res.status).toBe(204);
    const all = rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      messageId: 'msg-1',
      type: 'notification',
      payload: m.body,
      receivedAt: clock.now(),
      processedAt: null,
    });
    expect(wake).toHaveBeenCalledTimes(1);
  });

  test('invalid signature: 403, no row, secret not logged', async () => {
    const m = notification();
    m.headers['Twitch-Eventsub-Message-Signature'] = `sha256=${'0'.repeat(64)}`;
    const res = await post(m);
    expect(res.status).toBe(403);
    expect(rows()).toHaveLength(0);
    expect(wake).not.toHaveBeenCalled();
    expect(logs.join('\n')).not.toContain(TEST_WEBHOOK_SECRET);
  });

  test('body over 256 KB: 413, no row, worker not woken', async () => {
    const m = notification({
      payload: {
        subscription: { id: 'sub-1', type: 'stream.online' },
        event: { broadcaster_user_id: '42', pad: 'x'.repeat(1024 * 1024) },
      },
    });
    const res = await post(m);
    expect(res.status).toBe(413);
    expect(rows()).toHaveLength(0);
    expect(wake).not.toHaveBeenCalled();
  });

  test('large body below the limit still verifies against raw bytes', async () => {
    const m = notification({
      payload: {
        subscription: { id: 'sub-1', type: 'stream.online' },
        event: { broadcaster_user_id: '42', pad: 'ä'.repeat(100 * 1024) },
      },
    });
    const res = await post(m);
    expect(res.status).toBe(204);
    expect(rows()).toHaveLength(1);
  });

  test('tampered body: 403', async () => {
    const m = notification();
    const res = await app.request('/webhook', {
      method: 'POST',
      headers: m.headers,
      body: `${m.body} `,
    });
    expect(res.status).toBe(403);
  });

  test.each([
    'Twitch-Eventsub-Message-Id',
    'Twitch-Eventsub-Message-Timestamp',
    'Twitch-Eventsub-Message-Signature',
    'Twitch-Eventsub-Message-Type',
  ])('missing %s: 403', async (header) => {
    const m = notification();
    delete m.headers[header];
    const res = await post(m);
    expect(res.status).toBe(403);
    expect(rows()).toHaveLength(0);
  });

  test.each([
    ['stale', -11],
    ['future', 11],
  ])('%s timestamp: 403', async (_label, minutes) => {
    const m = notification({ timestamp: clock.now() + minutes * 60_000 });
    const res = await post(m);
    expect(res.status).toBe(403);
    expect(rows()).toHaveLength(0);
  });

  test('duplicate id: two 204, one row, one wake', async () => {
    const m = notification({ messageId: 'dup' });
    expect((await post(m)).status).toBe(204);
    expect((await post(m)).status).toBe(204);
    expect(rows()).toHaveLength(1);
    expect(wake).toHaveBeenCalledTimes(1);
  });

  test('callback verification: exact challenge as text/plain', async () => {
    const m = signedMessage({
      type: 'webhook_callback_verification',
      payload: {
        challenge: 'pogchamp-kappa-360noscope-vohiyo',
        subscription: {
          id: 'sub-1',
          status: 'webhook_callback_verification_pending',
        },
      },
      timestamp: clock.now(),
      messageId: 'verify-1',
    });
    const res = await post(m);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe('pogchamp-kappa-360noscope-vohiyo');
    expect(rows()[0]?.processedAt).toBe(clock.now());
    expect(wake).not.toHaveBeenCalled();
  });

  const insertSub = (id: string, status: string) =>
    handle.db
      .insert(subscriptions)
      .values({
        twitchSubId: id,
        type: 'stream.online',
        version: '1',
        broadcasterId: '42',
        status,
        createdAt: 0,
        updatedAt: 0,
      })
      .run();
  const verification = (id: string, callback = 'https://other.test/cb') =>
    signedMessage({
      type: 'webhook_callback_verification',
      payload: {
        challenge: 'ch-123',
        subscription: {
          id,
          status: 'webhook_callback_verification_pending',
          type: 'channel.update',
          version: '2',
          condition: { broadcaster_user_id: '77' },
          transport: { method: 'webhook', callback },
          created_at: '2026-01-01T00:00:00Z',
        },
      },
      timestamp: clock.now(),
    });
  const subStatus = (id: string) =>
    handle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.twitchSubId, id))
      .get()?.status;

  test('verification: pending mirror row becomes enabled, event emitted', async () => {
    insertSub('sub-5', 'webhook_callback_verification_pending');
    insertSub('sub-6', 'webhook_callback_verification_pending');
    const res = await post(verification('sub-5'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe('ch-123');
    expect(subStatus('sub-5')).toBe('enabled');
    expect(subStatus('sub-6')).toBe('webhook_callback_verification_pending');
    expect(publish).toHaveBeenCalledWith('subscriptions', { active: 2 });
  });

  test('verification for unknown id with foreign callback: no-op', async () => {
    insertSub('sub-5', 'webhook_callback_verification_pending');
    const res = await post(verification('other'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ch-123');
    expect(subStatus('sub-5')).toBe('webhook_callback_verification_pending');
    expect(subStatus('other')).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
  });

  test('verification before reconcile wrote the row: inserts enabled row', async () => {
    const res = await post(verification('early-1', CALLBACK));
    expect(await res.text()).toBe('ch-123');
    const row = handle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.twitchSubId, 'early-1'))
      .get();
    expect(row).toMatchObject({
      type: 'channel.update',
      version: '2',
      broadcasterId: '77',
      status: 'enabled',
    });
    expect(publish).toHaveBeenCalledWith('subscriptions', { active: 1 });
  });

  test('revocation: updates status, marks processed, requests reconcile', async () => {
    handle.db
      .insert(subscriptions)
      .values({
        twitchSubId: 'sub-9',
        type: 'stream.online',
        version: '1',
        broadcasterId: '42',
        status: 'enabled',
        createdAt: 0,
        updatedAt: 0,
      })
      .run();
    const m = signedMessage({
      type: 'revocation',
      payload: {
        subscription: {
          id: 'sub-9',
          status: 'user_removed',
          type: 'stream.online',
        },
      },
      timestamp: clock.now(),
    });
    const res = await post(m);
    expect(res.status).toBe(204);
    const sub = handle.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.twitchSubId, 'sub-9'))
      .get();
    expect(sub?.status).toBe('user_removed');
    expect(rows()[0]?.processedAt).toBe(clock.now());
    expect(request).toHaveBeenCalledWith('revocation');
    expect(logs.join('\n')).toContain('user_removed');
  });

  test('revocation for unknown subscription still 204 + reconcile', async () => {
    const m = signedMessage({
      type: 'revocation',
      payload: {
        subscription: { id: 'nope', status: 'authorization_revoked' },
      },
      timestamp: clock.now(),
    });
    expect((await post(m)).status).toBe(204);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('other routes', () => {
  test('GET / is 404', async () => {
    expect((await app.request('/')).status).toBe(404);
  });
  test('GET /webhook is 404', async () => {
    expect((await app.request('/webhook')).status).toBe(404);
  });
});
