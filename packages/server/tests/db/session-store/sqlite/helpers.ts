import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { migrateSqliteToLatest } from '../../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../../src/db/sqlite/client';
import { SqliteSessionStore } from '../../../../src/db/sqlite/session-store/SqliteSessionStore';

export interface SqliteStoreEnvironment {
  store: SqliteSessionStore;
  teardown: () => Promise<void>;
}

/**
 * Creates a throwaway file DB under an OS temp dir, migrates it, and returns
 * a SqliteSessionStore. Each contract test gets a fresh database.
 */
export async function createSqliteStoreEnvironment(): Promise<SqliteStoreEnvironment> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-sqlite-'));
  const dbPath = path.join(tempDir, 'session.sqlite');
  const db = createSqliteDb(dbPath);

  try {
    await migrateSqliteToLatest(db);
  } catch (error) {
    await db.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  const store = new SqliteSessionStore(db);
  return {
    store,
    async teardown() {
      await db.destroy();
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}
