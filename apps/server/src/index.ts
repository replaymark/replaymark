import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { openDb } from './db/client.ts';
import { type Env, loadEnv } from './env.ts';
import { applyHashTakeover } from './http/auth.ts';
import { createLogger } from './log.ts';

export const name = 'replaymark';

async function main(): Promise<void> {
  let env: Env;
  try {
    env = loadEnv();
  } catch (err) {
    console.error(
      `${name}: ${err instanceof Error ? err.message : String(err)}. See .env.example.`,
    );
    process.exit(1);
  }

  const logger = createLogger({
    level: env.LOG_LEVEL,
    secrets: [
      env.TWITCH_CLIENT_SECRET,
      env.TWITCH_WEBHOOK_SECRET,
      env.SMTP_PASSWORD ?? '',
      env.ADMIN_PASSWORD_HASH ?? '',
    ],
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { error: reason });
  });
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception', { error: err });
  });

  mkdirSync(env.DATA_DIR, { recursive: true });
  const handle = openDb(join(env.DATA_DIR, 'replaymark.db'));
  applyHashTakeover(handle.db, env.ADMIN_PASSWORD_HASH, logger);
  const app = createApp({ env, db: handle.db, logger });

  const ports = await app.listen({
    publicPort: env.PUBLIC_PORT,
    adminPort: env.ADMIN_PORT,
    internalPort: env.INTERNAL_PORT,
  });
  logger.info('listening', { ...ports });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('signal received', { signal });
    app
      .stop()
      .catch((err: unknown) => {
        logger.error('shutdown failed', { error: err });
      })
      .finally(() => {
        handle.close();
        process.exit(0);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.start();
}

if (import.meta.main) {
  void main();
}
