import { afterEach, describe, expect, it } from 'vitest';
import { type App, createApp } from '../src/app.ts';
import { systemClock } from '../src/clock.ts';
import type { DbHandle } from '../src/db/client.ts';
import { users } from '../src/db/schema.ts';
import { loadEnv } from '../src/env.ts';
import { createSession, SESSION_COOKIE } from '../src/http/auth.ts';
import { createTestDb } from './helpers/db.ts';
import { createFakeFetch, json } from './helpers/fetch.ts';

const env = loadEnv({
  TWITCH_CLIENT_ID: 'cid',
  TWITCH_CLIENT_SECRET: 'csecret',
  TWITCH_WEBHOOK_SECRET: 'webhook-secret-123',
  TWITCH_CALLBACK_URL: 'https://example.org/webhook',
  SMTP_HOST: 'smtp.example.org',
  SMTP_PORT: '587',
  SMTP_SECURITY: 'starttls',
  SMTP_FROM: 'n@example.org',
  ADMIN_PASSWORD_HASH: `scrypt$32768$8$1$${'A'.repeat(43)}=$${'A'.repeat(86)}==`,
  WEB_DIST: '/nonexistent',
});

const logs: string[] = [];
const logger = {
  debug() {},
  info: (m: string) => logs.push(`info ${m}`),
  warn: (m: string) => logs.push(`warn ${m}`),
  error: (m: string) => logs.push(`error ${m}`),
};

let handle: DbHandle | undefined;
let app: App | undefined;
afterEach(async () => {
  await app?.stop();
  handle?.close();
  app = undefined;
  handle = undefined;
  logs.length = 0;
});

describe('createApp', () => {
  it('starts, serves all listeners on ephemeral ports and stops cleanly', async () => {
    handle = createTestDb();
    const fake = createFakeFetch()
      .on(
        'https://id.twitch.tv/oauth2/token',
        // Responders are functions: @hono/node-server swaps the global
        // Response class on listen, which breaks `instanceof` on prebuilt ones.
        () =>
          json({ access_token: 't', expires_in: 3600, token_type: 'bearer' }),
      )
      .on('https://api.twitch.tv/helix/eventsub/subscriptions', () =>
        json({ data: [], pagination: {} }),
      );
    app = createApp({
      env,
      db: handle.db,
      logger,
      fetch: fake.fetch,
      transport: { async sendMail() {} },
    });
    const ports = await app.listen({
      publicPort: 0,
      adminPort: 0,
      internalPort: 0,
    });
    await app.start();
    expect(logs, logs.join('\n')).toContain('info first reconcile done');

    const health = await fetch(
      `http://127.0.0.1:${ports.internalPort}/healthz`,
    );
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      status: 'ok',
      lastSyncOk: true,
    });
    const pub = await fetch(`http://127.0.0.1:${ports.publicPort}/other`);
    expect(pub.status).toBe(404);
    const admin = await fetch(`http://127.0.0.1:${ports.adminPort}/api/me`);
    expect(admin.status).toBe(401);

    // An open SSE connection must not block shutdown.
    handle.db.update(users).set({ passwordHash: 'x' }).run();
    const cookie = createSession(handle.db, systemClock, 1);
    const sse = await fetch(`http://127.0.0.1:${ports.adminPort}/api/events`, {
      headers: { Cookie: `${SESSION_COOKIE}=${cookie}` },
    });
    expect(sse.status).toBe(200);
    const reader = (sse.body as ReadableStream<Uint8Array>).getReader();
    app.bus.publish('subscriptions', { active: 0 });
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain(
      'event: subscriptions',
    );
    await app.stop();
    // The stream ends either cleanly or by the forced socket close.
    const ended = await reader.read().then(
      (r) => r.done,
      () => true,
    );
    expect(ended).toBe(true);
    expect(logs).toContain('info stopped');
  });

  it('logs the setup code while setup is required and serves it to setup', async () => {
    handle = createTestDb();
    const fake = createFakeFetch().on('https://id.twitch.tv/oauth2/token', () =>
      json({ message: 'invalid client' }, 400),
    );
    app = createApp({
      env,
      db: handle.db,
      logger,
      fetch: fake.fetch,
      transport: { async sendMail() {} },
      generateSetupCode: () => 'ABCDE-FGHJK',
    });
    await app.start();
    expect(
      logs.some(
        (l) => l.startsWith('warn') && l.includes('Setup code: ABCDE-FGHJK'),
      ),
    ).toBe(true);
    const res = await app.adminApp.request('http://a.local/api/auth/setup', {
      method: 'POST',
      headers: {
        Host: 'a.local',
        Origin: 'http://a.local',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: 'ABCDE-FGHJK',
        username: 'mirko',
        email: 'm@x.test',
        password: 'a long password',
      }),
    });
    expect(res.status).toBe(200);
    const again = await app.adminApp.request('http://a.local/api/auth/setup');
    expect(await again.json()).toEqual({
      required: false,
      defaultLanguage: 'en',
    });
  });

  it('logs no setup code once an account has a password', async () => {
    handle = createTestDb();
    handle.db.update(users).set({ passwordHash: 'x' }).run();
    const fake = createFakeFetch().on('https://id.twitch.tv/oauth2/token', () =>
      json({ message: 'invalid client' }, 400),
    );
    app = createApp({
      env,
      db: handle.db,
      logger,
      fetch: fake.fetch,
      transport: { async sendMail() {} },
    });
    await app.start();
    expect(logs.some((l) => l.includes('Setup code'))).toBe(false);
  });

  it('only logs a failing first reconcile and still stops', async () => {
    handle = createTestDb();
    const fake = createFakeFetch().on('https://id.twitch.tv/oauth2/token', () =>
      json({ message: 'invalid client' }, 400),
    );
    app = createApp({
      env,
      db: handle.db,
      logger,
      fetch: fake.fetch,
      transport: { async sendMail() {} },
    });
    await app.listen({ publicPort: 0, internalPort: 0 });
    await app.start();
    expect(logs).toContain('warn first reconcile failed');
    await app.stop();
  });
});
