import type { AddressInfo } from 'node:net';
import type { ServerType } from '@hono/node-server';
import { afterEach, expect, it, vi } from 'vitest';
import { type App, createApp } from '../src/app.ts';
import type { DbHandle } from '../src/db/client.ts';
import { loadEnv } from '../src/env.ts';
import { createTestDb } from './helpers/db.ts';
import { createFakeFetch } from './helpers/fetch.ts';

const servers: ServerType[] = [];
vi.mock('@hono/node-server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@hono/node-server')>();
  return {
    ...mod,
    serve: (...args: Parameters<typeof mod.serve>) => {
      const server = mod.serve(...args);
      servers.push(server);
      return server;
    },
  };
});

const env = loadEnv({
  TWITCH_CLIENT_ID: 'cid',
  TWITCH_CLIENT_SECRET: 'csecret',
  TWITCH_WEBHOOK_SECRET: 'webhook-secret-123',
  TWITCH_CALLBACK_URL: 'https://example.org/webhook',
  SMTP_HOST: 'smtp.example.org',
  SMTP_PORT: '587',
  SMTP_SECURITY: 'starttls',
  SMTP_FROM: 'n@example.org',
  WEB_DIST: '/nonexistent',
});

let handle: DbHandle | undefined;
let app: App | undefined;
afterEach(async () => {
  await app?.stop();
  handle?.close();
});

it('binds the internal server to 127.0.0.1 only', async () => {
  handle = createTestDb();
  app = createApp({
    env,
    db: handle.db,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    fetch: createFakeFetch().fetch,
    transport: { async sendMail() {} },
  });
  const ports = await app.listen({ publicPort: 0, internalPort: 0 });
  const internal = servers
    .map((s) => s.address() as AddressInfo | null)
    .find((a) => a?.port === ports.internalPort);
  expect(internal?.address).toBe('127.0.0.1');
});
