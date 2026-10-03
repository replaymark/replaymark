import { hc } from 'hono/client';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { createBus } from '../src/events/bus.ts';
import type { AppType } from '../src/http/admin.ts';
import { createSseRegistry } from '../src/http/sse.ts';
import {
  type AdminHarness,
  createAdminHarness,
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
    expect(adminText).not.toContain('"broadcasterId":"100"');
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
