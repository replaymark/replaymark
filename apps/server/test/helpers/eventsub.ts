import { createHmac } from 'node:crypto';

export const TEST_WEBHOOK_SECRET = 'test-webhook-secret-0123456789';

export interface SignedMessageOptions {
  type: 'notification' | 'webhook_callback_verification' | 'revocation';
  payload: unknown;
  /** Epoch ms used for the Message-Timestamp header. */
  timestamp: number;
  messageId?: string;
  secret?: string;
  subscriptionType?: string;
}

export interface SignedMessage {
  headers: Record<string, string>;
  body: string;
}

export function sign(
  secret: string,
  messageId: string,
  timestamp: string,
  body: string,
): string {
  return `sha256=${createHmac('sha256', secret)
    .update(messageId + timestamp + body)
    .digest('hex')}`;
}

/** Build a correctly signed EventSub webhook request. */
export function signedMessage(opts: SignedMessageOptions): SignedMessage {
  const messageId = opts.messageId ?? crypto.randomUUID();
  const ts = new Date(opts.timestamp).toISOString();
  const body = JSON.stringify(opts.payload);
  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      'Twitch-Eventsub-Message-Id': messageId,
      'Twitch-Eventsub-Message-Timestamp': ts,
      'Twitch-Eventsub-Message-Signature': sign(
        opts.secret ?? TEST_WEBHOOK_SECRET,
        messageId,
        ts,
        body,
      ),
      'Twitch-Eventsub-Message-Type': opts.type,
      'Twitch-Eventsub-Subscription-Type':
        opts.subscriptionType ?? 'stream.online',
    },
  };
}
