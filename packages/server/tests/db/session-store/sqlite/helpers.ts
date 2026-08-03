import { SqliteSessionStore } from '../../../../src/db/sqlite/session-store/SqliteSessionStore';
import { createSqliteTestDatabase } from '../../sqlite/testDatabase';

export interface SqliteStoreEnvironment {
  store: SqliteSessionStore;
  teardown: () => Promise<void>;
}

/**
 * Creates a throwaway file DB under an OS temp dir, migrates it, and returns
 * a SqliteSessionStore. Each contract test gets a fresh database.
 */
export async function createSqliteStoreEnvironment(): Promise<SqliteStoreEnvironment> {
  const testDatabase = await createSqliteTestDatabase();
  return {
    store: new SqliteSessionStore(testDatabase.db),
    teardown: testDatabase.teardown,
  };
}
