import { hc } from 'hono/client';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { createBus } from '../src/events/bus.ts';
import type { AppType } from '../src/http/admin.ts';
import { createSseRegistry } from '../src/http/sse.ts';
import { type AdminHarness, createAdminHarness } from './helpers/admin.ts';

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

describe('AppType', () => {
  it('includes the auth routes', () => {
    const client = hc<AppType>('http://localhost');
    expectTypeOf(client.api.auth.login.$post).toBeFunction();
    expectTypeOf(client.api.auth.logout.$post).toBeFunction();
    expectTypeOf(client.api.auth.me.$get).toBeFunction();
    expectTypeOf(client.api.events.$get).toBeFunction();
  });
});
