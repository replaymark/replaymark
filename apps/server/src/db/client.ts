import path from 'node:path';
import Database from 'better-sqlite3';
import {
  type BetterSQLite3Database,
  drizzle,
} from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';
import { ensureRecordingSince } from './settings.ts';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  db: Db;
  sqlite: Database.Database;
  close(): void;
}

const migrationsFolder = path.resolve(import.meta.dirname, '../../drizzle');

function appliedMigrations(sqlite: Database.Database): number {
  const table = sqlite
    .prepare(
      "select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
    )
    .get();
  if (!table) return 0;
  return (
    sqlite.prepare('select count(*) as n from __drizzle_migrations').get() as {
      n: number;
    }
  ).n;
}

export function openDb(file: string | ':memory:'): DbHandle {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  // Migrations rebuild tables; the PRAGMA only works outside their transaction.
  sqlite.pragma('foreign_keys = OFF');
  const db = drizzle(sqlite, { schema });
  const before = appliedMigrations(sqlite);
  migrate(db, { migrationsFolder });
  if (appliedMigrations(sqlite) > before) {
    const broken = sqlite.pragma('foreign_key_check') as unknown[];
    if (broken.length > 0)
      throw new Error(
        `migration left ${broken.length} foreign key violations; restore the database from the backup`,
      );
  }
  sqlite.pragma('foreign_keys = ON');
  ensureRecordingSince(db, Date.now());
  return { db, sqlite, close: () => sqlite.close() };
}
