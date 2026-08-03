import { sql, type Kysely } from 'kysely';

import { PostgresSessionStore } from '../../../../src/db/postgres/session-store/PostgresSessionStore';
import type { Database } from '../../../../src/db/postgres/types';
import { createPostgresTestDatabase } from '../../postgres/testDatabase';

export interface PostgresStoreEnvironment {
  store: PostgresSessionStore;
  reset: () => Promise<void>;
  teardown: () => Promise<void>;
}

async function truncateSessionStore(db: Kysely<Database>): Promise<void> {
  await sql`
    TRUNCATE TABLE
      thread_capability_state,
      session_event,
      thread_context_log,
      turn_thread,
      turn,
      session
    RESTART IDENTITY CASCADE
  `.execute(db);
}

/**
 * Creates a throwaway database, migrates it, and returns a PostgresSessionStore bound to it.
 * Each test file should call this once in beforeAll and teardown in afterAll.
 */
export async function createPostgresStoreEnvironment(): Promise<PostgresStoreEnvironment | undefined> {
  const testDatabase = await createPostgresTestDatabase();
  if (testDatabase === undefined) {
    return undefined;
  }

  return {
    store: new PostgresSessionStore(testDatabase.db),
    reset: () => truncateSessionStore(testDatabase.db),
    teardown: testDatabase.teardown,
  };
}
