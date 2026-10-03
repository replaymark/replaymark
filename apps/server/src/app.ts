import { resolve } from 'node:path';
import { type ServerType, serve } from '@hono/node-server';
import { count } from 'drizzle-orm';
import { type Clock, systemClock } from './clock.ts';
import type { Db } from './db/client.ts';
import { streamers } from './db/schema.ts';
import { getMeta } from './db/settings.ts';
import type { Env } from './env.ts';
import { createBus } from './events/bus.ts';
import { createAdminApp } from './http/admin.ts';
import { generateSetupCode, isSetupRequired } from './http/auth.ts';
import { createInternalApp } from './http/internal.ts';
import { createPublicApp } from './http/public.ts';
import { createSseRegistry } from './http/sse.ts';
import { runCleanup } from './jobs/cleanup.ts';
import { createInboxWorker } from './jobs/inbox-worker.ts';
import { createOutboxWorker } from './jobs/outbox-worker.ts';
import { createScheduler } from './jobs/scheduler.ts';
import { createLogger, type Logger } from './log.ts';
import {
  createMailer,
  createTransport,
  type MailTransport,
} from './mail/mailer.ts';
import { createLiveSync } from './notify/live-sync.ts';
import type { SyncResult } from './shared/events.ts';
import { createVodResolver } from './timeline/resolver.ts';
import { createHelix } from './twitch/helix.ts';
import { createReconciler } from './twitch/reconcile.ts';
import { createTokenProvider } from './twitch/token.ts';

export const SHUTDOWN_TIMEOUT_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const VOD_RESOLVE_EVERY_MS = 10 * 60 * 1000;

/** Default SPA location: `apps/web/dist`, relative to the server package. */
export const DEFAULT_WEB_DIST = resolve(import.meta.dirname, '../../web/dist');

export interface AppDeps {
  env: Env;
  db: Db;
  clock?: Clock;
  logger?: Logger;
  /** fetch used for Twitch (token + Helix). */
  fetch?: typeof fetch;
  transport?: MailTransport;
  /** Setup code generator (tests inject a fixed one). */
  generateSetupCode?: () => string;
  webDist?: string;
}

export interface ListenOptions {
  publicPort: number;
  /** Admin listener is skipped when undefined. */
  adminPort?: number;
  internalPort: number;
  publicHost?: string;
  adminHost?: string;
  internalHost?: string;
}

export interface Listening {
  publicPort: number;
  adminPort?: number;
  internalPort: number;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Composition root (D2): wires all services, apps and jobs. */
export function createApp(deps: AppDeps) {
  const { env, db } = deps;
  const clock = deps.clock ?? systemClock;
  const logger = deps.logger ?? createLogger({ level: env.LOG_LEVEL });
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const timeZone = env.TZ;

  const bus = createBus();
  const sse = createSseRegistry();
  const token = createTokenProvider({
    clientId: env.TWITCH_CLIENT_ID,
    clientSecret: env.TWITCH_CLIENT_SECRET,
    fetch: fetchImpl,
    clock,
  });
  const helix = createHelix({
    clientId: env.TWITCH_CLIENT_ID,
    token,
    fetch: fetchImpl,
    clock,
  });
  const mailer = createMailer({
    transport: deps.transport ?? createTransport(env),
    from: env.SMTP_FROM,
  });
  const outbox = createOutboxWorker({ db, mailer, clock, logger, bus });
  const notifyDeps = {
    db,
    clock,
    bus,
    timeZone,
    onQueued: () => outbox.wake(),
    adminUrl: env.PUBLIC_BASE_URL,
  };
  const liveSync = createLiveSync({ ...notifyDeps, helix, logger });
  const inner = createReconciler({
    db,
    helix,
    clock,
    logger,
    bus,
    callbackUrl: env.TWITCH_CALLBACK_URL,
    webhookSecret: env.TWITCH_WEBHOOK_SECRET,
    liveSync,
  });

  // Track in-flight reconciles so shutdown can wait for them.
  const pending = new Set<Promise<void>>();
  const reconciler = {
    ...inner,
    request(reason: string): Promise<void> {
      const p = inner.request(reason);
      pending.add(p);
      void p.finally(() => pending.delete(p));
      return p;
    },
  };

  const inbox = createInboxWorker({ ...notifyDeps, helix, logger });
  const vodResolver = createVodResolver({ db, helix, clock, logger, bus });
  // After a stream goes offline its archive is final; resolve soon (debounced,
  // off the inbox path).
  const unsubscribeVod = bus.subscribe((e) => {
    if (e.type === 'live-state' && !e.payload.live) vodResolver.trigger();
  });
  const scheduler = createScheduler({
    clock,
    logger,
    tasks: [
      {
        name: 'cleanup',
        everyMs: DAY_MS,
        run: () => runCleanup({ db, clock }),
      },
      {
        name: 'vod-resolver',
        everyMs: VOD_RESOLVE_EVERY_MS,
        run: () => vodResolver.run(),
      },
    ],
  });

  const publicApp = createPublicApp({
    db,
    clock,
    logger,
    bus,
    webhookSecret: env.TWITCH_WEBHOOK_SECRET,
    callbackUrl: env.TWITCH_CALLBACK_URL,
    inboxWorker: inbox,
    reconciler: {
      request: (reason) => {
        void reconciler.request(reason);
      },
    },
  });
  // One-time setup code, only while no account has a password; memory only.
  let setupCode = isSetupRequired(db)
    ? (deps.generateSetupCode ?? generateSetupCode)()
    : undefined;
  const adminApp = createAdminApp({
    db,
    clock,
    logger,
    helix,
    reconciler,
    outbox,
    mailer,
    adminUrl: env.PUBLIC_BASE_URL,
    callbackUrl: env.TWITCH_CALLBACK_URL,
    defaultLanguage: env.DEFAULT_LANGUAGE,
    setupCode: () => (isSetupRequired(db) ? setupCode : undefined),
    cookieSecure: env.ADMIN_COOKIE_SECURE,
    webDist: deps.webDist ?? env.WEB_DIST ?? DEFAULT_WEB_DIST,
    events: { bus, registry: sse },
  });
  const internalApp = createInternalApp({
    db,
    clock,
    logger,
    helix,
    reconciler,
    mailer,
    adminUrl: env.PUBLIC_BASE_URL,
  });

  const servers: ServerType[] = [];
  let started = false;
  let stopping: Promise<void> | undefined;

  async function start(): Promise<void> {
    if (started) return;
    started = true;
    const n = db.select({ n: count() }).from(streamers).get()?.n ?? 0;
    if (setupCode && isSetupRequired(db)) {
      logger.warn(
        `No account exists yet. Open the admin UI and finish setup with this code, valid until the service restarts: Setup code: ${setupCode}`,
      );
    } else {
      setupCode = undefined;
    }
    logger.info('starting', {
      callbackUrl: env.TWITCH_CALLBACK_URL,
      streamers: n,
    });
    await inbox.drain();
    inbox.start();
    outbox.start();
    scheduler.start();
    await reconciler.request('startup');
    const last = getMeta<SyncResult>(db, 'last_sync');
    if (last?.ok) {
      logger.info('first reconcile done', {
        active: last.active,
        created: last.created,
        deleted: last.deleted,
      });
    } else {
      logger.warn('first reconcile failed', {
        errors: last?.errors ?? ['no result'],
      });
    }
    if (!stopping) reconciler.startInterval();
  }

  function listenOne(
    fetchFn: (req: Request) => Response | Promise<Response>,
    port: number,
    hostname: string,
  ): Promise<number> {
    return new Promise((resolvePort, reject) => {
      const server = serve({ fetch: fetchFn, port, hostname }, (info) =>
        resolvePort(info.port),
      );
      server.once('error', reject);
      servers.push(server);
    });
  }

  async function listen(opts: ListenOptions): Promise<Listening> {
    const publicPort = await listenOne(
      publicApp.fetch,
      opts.publicPort,
      opts.publicHost ?? '0.0.0.0',
    );
    const adminPort =
      opts.adminPort === undefined
        ? undefined
        : await listenOne(
            adminApp.fetch,
            opts.adminPort,
            opts.adminHost ?? '0.0.0.0',
          );
    const internalPort = await listenOne(
      internalApp.fetch,
      opts.internalPort,
      opts.internalHost ?? '127.0.0.1',
    );
    return { publicPort, adminPort, internalPort };
  }

  async function doStop(): Promise<void> {
    logger.info('shutting down');
    const closed = servers.map(
      (s) =>
        new Promise<void>((done) => {
          s.close(() => done());
        }),
    );
    inner.stop();
    inbox.stop();
    outbox.stop();
    scheduler.stop();
    unsubscribeVod();
    vodResolver.stop();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((done) => {
      timer = setTimeout(() => done('timeout'), SHUTDOWN_TIMEOUT_MS);
    });
    const work = Promise.all([
      inbox.drain(),
      outbox.inFlight(),
      vodResolver.inFlight(),
      ...pending,
    ]).then(
      () => 'done' as const,
      (err: unknown) => {
        logger.error('shutdown wait failed', { error: errText(err) });
        return 'done' as const;
      },
    );
    const outcome = await Promise.race([work, timeout]);
    clearTimeout(timer);
    if (outcome === 'timeout')
      logger.warn('shutdown timeout, abandoning in-flight jobs');

    sse.closeAll();
    for (const s of servers) {
      if ('closeAllConnections' in s) s.closeAllConnections();
    }
    await Promise.all(closed);
    servers.length = 0;
    logger.info('stopped');
  }

  function stop(): Promise<void> {
    stopping ??= doStop();
    return stopping;
  }

  return {
    bus,
    sse,
    helix,
    reconciler,
    inbox,
    outbox,
    vodResolver,
    mailer,
    publicApp,
    adminApp,
    internalApp,
    start,
    listen,
    stop,
  };
}

export type App = ReturnType<typeof createApp>;
