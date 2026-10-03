import { type DbHandle, openDb } from '../../src/db/client.ts';

/** Fresh, fully migrated in-memory database. Call `close()` when done. */
export function createTestDb(): DbHandle {
  return openDb(':memory:');
}
