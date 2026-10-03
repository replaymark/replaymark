import { describe, expect, test } from 'vitest';
import { createTokenProvider, TOKEN_URL } from '../src/twitch/token.ts';
import { createFakeClock } from './helpers/clock.ts';
import { createFakeFetch, json } from './helpers/fetch.ts';

function setup() {
  const clock = createFakeClock();
  const f = createFakeFetch();
  const token = createTokenProvider({
    clientId: 'cid',
    clientSecret: 'csecret',
    fetch: f.fetch,
    clock,
  });
  return { clock, f, token };
}

describe('token provider', () => {
  test('posts client credentials and caches the token', async () => {
    const { f, token } = setup();
    f.on(TOKEN_URL, json({ access_token: 'a', expires_in: 3600 }));
    expect(await token.getToken()).toBe('a');
    expect(await token.getToken()).toBe('a');
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.method).toBe('POST');
    expect(f.requests[0]?.body).toContain('grant_type=client_credentials');
    expect(f.requests[0]?.body).toContain('client_id=cid');
  });

  test('renews 5 minutes before expiry', async () => {
    const { clock, f, token } = setup();
    f.on(
      TOKEN_URL,
      json({ access_token: 'a', expires_in: 3600 }),
      json({ access_token: 'b', expires_in: 3600 }),
    );
    await token.getToken();
    clock.advance(3600_000 - 5 * 60_000 - 1);
    expect(await token.getToken()).toBe('a');
    clock.advance(1);
    expect(await token.getToken()).toBe('b');
    expect(f.requests).toHaveLength(2);
  });

  test('concurrent callers share one request', async () => {
    const { f, token } = setup();
    f.on(TOKEN_URL, json({ access_token: 'a', expires_in: 3600 }));
    const all = await Promise.all([
      token.getToken(),
      token.getToken(),
      token.getToken(),
    ]);
    expect(all).toEqual(['a', 'a', 'a']);
    expect(f.requests).toHaveLength(1);
  });

  test('invalidate forces a new request', async () => {
    const { f, token } = setup();
    f.on(
      TOKEN_URL,
      json({ access_token: 'a', expires_in: 3600 }),
      json({ access_token: 'b', expires_in: 3600 }),
    );
    await token.getToken();
    token.invalidate();
    expect(await token.getToken()).toBe('b');
  });

  test('failure is reported without the secret', async () => {
    const { f, token } = setup();
    f.on(TOKEN_URL, json({ message: 'invalid client' }, 400));
    const err = await token.getToken().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).not.toContain('csecret');
  });
});
