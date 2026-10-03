import { describe, expect, test } from 'vitest';
import { verifySignature } from '../src/twitch/signature.ts';
import { sign } from './helpers/eventsub.ts';

const enc = (s: string) => new TextEncoder().encode(s);

describe('verifySignature', () => {
  const ts = '2023-11-14T22:13:20.000Z';
  const body = '{"a":1}';
  const good = sign('secret', 'id-1', ts, body);

  test('accepts a correct signature', () => {
    expect(verifySignature('secret', 'id-1', ts, enc(body), good)).toBe(true);
  });
  test('rejects wrong secret, id, timestamp or body', () => {
    expect(verifySignature('other', 'id-1', ts, enc(body), good)).toBe(false);
    expect(verifySignature('secret', 'id-2', ts, enc(body), good)).toBe(false);
    expect(verifySignature('secret', 'id-1', `${ts}x`, enc(body), good)).toBe(
      false,
    );
    expect(verifySignature('secret', 'id-1', ts, enc('{"a":2}'), good)).toBe(
      false,
    );
  });
  test('rejects headers of the wrong length without throwing', () => {
    expect(verifySignature('secret', 'id-1', ts, enc(body), 'sha256=ab')).toBe(
      false,
    );
    expect(verifySignature('secret', 'id-1', ts, enc(body), '')).toBe(false);
    expect(verifySignature('secret', 'id-1', ts, enc(body), `${good}00`)).toBe(
      false,
    );
  });
  test('rejects a missing sha256= prefix', () => {
    const hex = good.slice('sha256='.length);
    expect(
      verifySignature('secret', 'id-1', ts, enc(body), `sha512=${hex}`),
    ).toBe(false);
  });
});
