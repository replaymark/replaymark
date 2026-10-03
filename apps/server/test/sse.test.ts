import { eq } from 'drizzle-orm';
import { hc } from 'hono/client';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { streams, users } from '../src/db/schema.ts';
import { createBus } from '../src/events/bus.ts';
import type { AppType } from '../src/http/admin.ts';
import { hashPassword } from '../src/http/auth.ts';
import { createSseRegistry } from '../src/http/sse.ts';
import {
  type AdminHarness,
  createAdminHarness,
  followAs,
  HOST,
  ORIGIN,
  seedAccount,
} from './helpers/admin.ts';
import { seedStreamer } from './helpers/seed.ts';

let h: AdminHarness | undefined;
afterEach(() => {
  h?.handle.close();
  h = undefined;
});

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe('GET /api/events', () => {
  it('streams bus events with SSE headers and unsubscribes on abort', async () => {
    const bus = createBus();
    const registry = createSseRegistry();
    h = createAdminHarness({ events: { bus, registry, pingMs: 5 } });
    const ac = new AbortController();
    const res = await h.req('/api/events', { signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('X-Accel-Buffering')).toBe('no');
    expect(registry.size()).toBe(1);

    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    bus.publish('subscriptions', { active: 3 });
    const text = await readUntil(reader, 'data: {"active":3}');
    expect(text).toContain('event: subscriptions\ndata: {"active":3}\n\n');
    expect(await readUntil(reader, ': ping')).toContain(': ping');

    await reader.cancel();
    ac.abort();
    await new Promise((r) => setTimeout(r, 10));
    expect(registry.size()).toBe(0);
  });

  it('closeAll ends open streams', async () => {
    const bus = createBus();
    const registry = createSseRegistry();
    h = createAdminHarness({ events: { bus, registry } });
    const res = await h.req('/api/events');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    registry.closeAll();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    expect(registry.size()).toBe(0);
  });

  it('requires a session', async () => {
    const registry = createSseRegistry();
    h = createAdminHarness({ events: { bus: createBus(), registry } });
    const res = await h.req('/api/events', { headers: { Cookie: 'x=y' } });
    expect(res.status).toBe(401);
    expect(registry.size()).toBe(0);
  });
});

async function drain(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  const stop = Symbol('stop');
  for (;;) {
    const r = await Promise.race([
      reader.read(),
      new Promise<typeof stop>((res) => setTimeout(() => res(stop), ms)),
    ]);
    if (r === stop || r.done) return text;
    text += decoder.decode(r.value, { stream: true });
  }
}

describe('GET /api/events scoping', () => {
  it("only delivers events about the account's broadcasters; sync and subscriptions only to admins", async () => {
    const bus = createBus();
    h = createAdminHarness({
      events: { bus, registry: createSseRegistry(), pingMs: 60_000 },
    });
    seedStreamer(h.handle.db, { id: '100', ownerId: seedAccount(h, 'mia').id });
    const tom = seedAccount(h, 'tom');
    seedStreamer(h.handle.db, { id: '200', ownerId: tom.id });
    const adminRes = await h.req('/api/events');
    const tomRes = await tom.req('/api/events');
    bus.publish('live-state', { broadcasterId: '100', live: true });
    bus.publish('notification', {
      ownerId: 1,
      streamId: 's',
      categoryId: 'c',
      broadcasterId: '100',
    });
    bus.publish('live-state', { broadcasterId: '200', live: true });
    bus.publish('sync', { phase: 'start', reason: 'x' });
    bus.publish('subscriptions', { active: 1 });
    bus.publish('groups', { ownerId: tom.id });
    bus.publish('groups', { ownerId: 999 });
    const tomText = await drain(
      (tomRes.body as ReadableStream<Uint8Array>).getReader(),
      100,
    );
    expect(tomText).toContain('"broadcasterId":"200"');
    expect(tomText).not.toContain('"broadcasterId":"100"');
    expect(tomText).not.toContain('event: sync');
    expect(tomText).not.toContain('event: subscriptions');
    expect(tomText).toContain(`event: groups\ndata: {"ownerId":${tom.id}}`);
    expect(tomText).not.toContain('"ownerId":999');
    const adminText = await drain(
      (adminRes.body as ReadableStream<Uint8Array>).getReader(),
      100,
    );
    expect(adminText).toContain('event: sync');
    expect(adminText).toContain('event: subscriptions');
    // Admins see every owner's notifications (as on the history page), but no foreign live state.
    expect(adminText).toContain('event: notification');
    expect(adminText).not.toContain(
      'event: live-state\ndata: {"broadcasterId":"100"',
    );
    expect(tomText).not.toContain('event: notification');
  });
});

async function endsWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
): Promise<boolean> {
  const stop = Symbol('stop');
  for (;;) {
    const r = await Promise.race([
      reader.read(),
      new Promise<typeof stop>((res) => setTimeout(() => res(stop), ms)),
    ]);
    if (r === stop) return false;
    if (r.done) return true;
  }
}

describe('GET /api/events session binding', () => {
  const cookieOf = (res: Response) =>
    /replaymark_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];

  it('ends after logout, on the next ping', async () => {
    h = createAdminHarness({
      events: { bus: createBus(), registry: createSseRegistry(), pingMs: 10 },
    });
    const res = await h.req('/api/events');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    expect((await h.req('/api/auth/logout', { method: 'POST' })).status).toBe(
      200,
    );
    expect(await endsWithin(reader, 1000)).toBe(true);
  });

  it('delivers nothing after the stream ended with the session', async () => {
    const bus = createBus();
    h = createAdminHarness({
      events: { bus, registry: createSseRegistry(), pingMs: 10 },
    });
    const res = await h.req('/api/events');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await h.req('/api/auth/logout', { method: 'POST' });
    expect(await endsWithin(reader, 1000)).toBe(true);
    bus.publish('subscriptions', { active: 7 });
    const text = await drain(reader, 200);
    expect(text).not.toContain('"active":7');
  });

  it('ends after the session expired', async () => {
    h = createAdminHarness({
      events: { bus: createBus(), registry: createSseRegistry(), pingMs: 10 },
    });
    const res = await h.req('/api/events');
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    h.clock.advance(31 * 24 * 60 * 60 * 1000);
    expect(await endsWithin(reader, 1000)).toBe(true);
  });

  it('ends after a password change of another session of the account', async () => {
    h = createAdminHarness({
      events: { bus: createBus(), registry: createSseRegistry(), pingMs: 10 },
    });
    const hash = await hashPassword('old password');
    h.handle.db
      .update(users)
      .set({ passwordHash: hash })
      .where(eq(users.id, 1))
      .run();
    // Second session of the same account, running the stream.
    const login = await h.app.request(`http://${HOST}/api/auth/login`, {
      method: 'POST',
      headers: {
        Host: HOST,
        Origin: ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: h.handle.db.select().from(users).get()?.username,
        password: 'old password',
      }),
    });
    const other = cookieOf(login);
    expect(other).toBeDefined();
    const res = await h.req('/api/events', {
      headers: { Cookie: `replaymark_session=${other}` },
    });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    // Change the password with the harness' own session.
    const change = await h.req('/api/account/password', {
      method: 'POST',
      json: { currentPassword: 'old password', newPassword: 'new password 1' },
    });
    expect(change.status).toBe(200);
    expect(await endsWithin(reader, 1000)).toBe(true);
  });

  it('keeps Cache-Control: no-cache', async () => {
    h = createAdminHarness({
      events: { bus: createBus(), registry: createSseRegistry() },
    });
    const res = await h.req('/api/events');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    await res.body?.cancel();
  });
});

describe('GET /api/events notification scoping', () => {
  it('two accounts following one broadcaster only get their own notifications', async () => {
    const bus = createBus();
    h = createAdminHarness({
      events: { bus, registry: createSseRegistry(), pingMs: 60_000 },
    });
    const mia = seedAccount(h, 'mia');
    const tom = seedAccount(h, 'tom');
    seedStreamer(h.handle.db, { id: '100', ownerId: mia.id });
    followAs(h, tom.id, '100');
    const miaRes = await mia.req('/api/events');
    const tomRes = await tom.req('/api/events');
    for (const ownerId of [mia.id, tom.id])
      bus.publish('notification', {
        ownerId,
        streamId: 's',
        categoryId: 'c',
        broadcasterId: '100',
      });
    const text = async (r: Response) =>
      drain((r.body as ReadableStream<Uint8Array>).getReader(), 100);
    const miaText = await text(miaRes);
    const tomText = await text(tomRes);
    expect(miaText).toContain(`"ownerId":${mia.id}`);
    expect(miaText).not.toContain(`"ownerId":${tom.id}`);
    expect(tomText).toContain(`"ownerId":${tom.id}`);
    expect(tomText).not.toContain(`"ownerId":${mia.id}`);
  });

  it('delivers groups and timeline events only to the owning account', async () => {
    const bus = createBus();
    h = createAdminHarness({
      events: { bus, registry: createSseRegistry(), pingMs: 60_000 },
    });
    const mia = seedAccount(h, 'mia');
    const tom = seedAccount(h, 'tom');
    seedStreamer(h.handle.db, { id: '100', ownerId: mia.id });
    h.handle.db
      .insert(streams)
      .values({
        streamId: 'st1',
        broadcasterId: '100',
        startedAt: 1,
      })
      .run();
    const miaRes = await mia.req('/api/events');
    const tomRes = await tom.req('/api/events');
    bus.publish('groups', { ownerId: mia.id });
    bus.publish('timeline', { streamId: 'st1' });
    const miaText = await drain(
      (miaRes.body as ReadableStream<Uint8Array>).getReader(),
      100,
    );
    const tomText = await drain(
      (tomRes.body as ReadableStream<Uint8Array>).getReader(),
      100,
    );
    expect(miaText).toContain('event: groups');
    expect(miaText).toContain('event: timeline');
    expect(tomText).not.toContain('event: groups');
    expect(tomText).not.toContain('event: timeline');
  });
});

describe('AppType', () => {
  it('includes the auth routes', () => {
    const client = hc<AppType>('http://localhost');
    expectTypeOf(client.api.auth.login.$post).toBeFunction();
    expectTypeOf(client.api.auth.logout.$post).toBeFunction();
    expectTypeOf(client.api.auth.me.$get).toBeFunction();
    expectTypeOf(client.api.events.$get).toBeFunction();
  });
});
