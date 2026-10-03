import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import { eventsubInbox, subscriptions } from '../db/schema.ts';
import type { Bus } from '../events/bus.ts';
import type { Logger } from '../log.ts';
import { parseSubscription } from '../twitch/helix.ts';
import { mirrorRow } from '../twitch/reconcile.ts';
import { verifySignature } from '../twitch/signature.ts';

export interface PublicAppDeps {
  db: Db;
  clock: Clock;
  logger: Logger;
  bus: Pick<Bus, 'publish'>;
  webhookSecret: string;
  callbackUrl: string;
  inboxWorker: { wake(): void };
  reconciler: { request(reason: string): void };
}

const HEALTHY_STATUSES = ['enabled', 'webhook_callback_verification_pending'];
const MAX_SKEW_MS = 10 * 60 * 1000;
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

interface EventsubBody {
  challenge?: unknown;
  subscription?: {
    id?: unknown;
    status?: unknown;
    type?: unknown;
  } & Record<string, unknown>;
}

/** Public app (port 8080): only `POST /webhook`, everything else 404. */
export function createPublicApp(deps: PublicAppDeps) {
  const { db, clock, logger, webhookSecret } = deps;
  const app = new Hono();

  app.post(
    '/webhook',
    bodyLimit({
      maxSize: MAX_WEBHOOK_BODY_BYTES,
      onError: (c) => {
        logger.warn('webhook rejected: body too large');
        return c.body(null, 413);
      },
    }),
    async (c) => {
      const raw = new Uint8Array(await c.req.arrayBuffer());
      const messageId = c.req.header('Twitch-Eventsub-Message-Id');
      const timestamp = c.req.header('Twitch-Eventsub-Message-Timestamp');
      const signature = c.req.header('Twitch-Eventsub-Message-Signature');
      const messageType = c.req.header('Twitch-Eventsub-Message-Type');
      const subscriptionType = c.req.header(
        'Twitch-Eventsub-Subscription-Type',
      );

      if (!messageId || !timestamp || !signature || !messageType) {
        logger.warn('webhook rejected: missing header', {
          messageId,
          hasTimestamp: !!timestamp,
          hasSignature: !!signature,
          hasType: !!messageType,
        });
        return c.body(null, 403);
      }
      if (
        !verifySignature(webhookSecret, messageId, timestamp, raw, signature)
      ) {
        logger.warn('webhook rejected: signature mismatch', { messageId });
        return c.body(null, 403);
      }
      const sentAt = Date.parse(timestamp);
      const now = clock.now();
      if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > MAX_SKEW_MS) {
        logger.warn('webhook rejected: timestamp out of range', {
          messageId,
          timestamp,
        });
        return c.body(null, 403);
      }

      const payloadText = new TextDecoder().decode(raw);
      const inserted = db
        .insert(eventsubInbox)
        .values({
          messageId,
          type: messageType,
          payload: payloadText,
          receivedAt: now,
        })
        .onConflictDoNothing()
        .run();
      if (inserted.changes === 0) {
        logger.debug('webhook duplicate', { messageId });
        return c.body(null, 204);
      }

      const markProcessed = (error?: string) =>
        db
          .update(eventsubInbox)
          .set({ processedAt: clock.now(), error: error ?? null })
          .where(eq(eventsubInbox.messageId, messageId))
          .run();

      let body: EventsubBody;
      try {
        body = JSON.parse(payloadText) as EventsubBody;
      } catch {
        logger.warn('webhook body is not JSON', { messageId });
        markProcessed('invalid json');
        return c.body(null, 204);
      }

      switch (messageType) {
        case 'webhook_callback_verification': {
          const challenge =
            typeof body.challenge === 'string' ? body.challenge : '';
          markProcessed();
          logger.info('webhook verification', { messageId, subscriptionType });
          const subId =
            typeof body.subscription?.id === 'string'
              ? body.subscription.id
              : undefined;
          if (subId) {
            try {
              let changes = db
                .update(subscriptions)
                .set({ status: 'enabled', updatedAt: now })
                .where(eq(subscriptions.twitchSubId, subId))
                .run().changes;
              // Twitch may verify before reconcile has written its row.
              const sub = parseSubscription(body.subscription ?? {});
              if (changes === 0 && sub.callback === deps.callbackUrl) {
                changes = db
                  .insert(subscriptions)
                  .values(mirrorRow({ ...sub, status: 'enabled' }, now))
                  .onConflictDoNothing()
                  .run().changes;
              }
              if (changes > 0) {
                const active = db
                  .select({ id: subscriptions.twitchSubId })
                  .from(subscriptions)
                  .where(inArray(subscriptions.status, HEALTHY_STATUSES))
                  .all().length;
                deps.bus.publish('subscriptions', { active });
              }
            } catch (err) {
              logger.error('webhook verification: mirror update failed', {
                messageId,
                subscriptionId: subId,
                error: String(err),
              });
            }
          }
          return c.body(challenge, 200, { 'Content-Type': 'text/plain' });
        }
        case 'notification':
          deps.inboxWorker.wake();
          return c.body(null, 204);
        case 'revocation': {
          const sub = body.subscription ?? {};
          const status =
            typeof sub.status === 'string' ? sub.status : 'revoked';
          const subId = typeof sub.id === 'string' ? sub.id : undefined;
          logger.warn('eventsub subscription revoked', {
            messageId,
            subscriptionId: subId,
            subscriptionType,
            reason: status,
          });
          if (subId) {
            db.update(subscriptions)
              .set({ status, updatedAt: clock.now() })
              .where(eq(subscriptions.twitchSubId, subId))
              .run();
          }
          markProcessed();
          deps.reconciler.request('revocation');
          return c.body(null, 204);
        }
        default:
          logger.warn('webhook unknown message type', {
            messageId,
            messageType,
          });
          markProcessed('unknown message type');
          return c.body(null, 204);
      }
    },
  );

  app.notFound((c) => c.body(null, 404));
  return app;
}
