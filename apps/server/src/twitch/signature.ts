import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

/** Verify a Twitch EventSub `sha256=<hex>` signature over id + timestamp + raw body. */
export function verifySignature(
  secret: string,
  messageId: string,
  timestamp: string,
  rawBody: Uint8Array,
  header: string,
): boolean {
  const expected = Buffer.from(
    PREFIX +
      createHmac('sha256', secret)
        .update(messageId)
        .update(timestamp)
        .update(rawBody)
        .digest('hex'),
  );
  const actual = Buffer.from(header);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
