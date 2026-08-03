/**
 * Creates a throwaway, fully migrated SQLite file database under an OS temp
 * dir for store tests. Each call gets a fresh database.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Kysely } from 'kysely';

import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import type { Database } from '../../../src/db/sqlite/types';

export interface SqliteTestDatabase {
  db: Kysely<Database>;
  teardown: () => Promise<void>;
}

export async function createSqliteTestDatabase(): Promise<SqliteTestDatabase> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-sqlite-'));
  const db = createSqliteDb(path.join(tempDir, 'store.sqlite'));

  try {
    await migrateSqliteToLatest(db);
  } catch (error) {
    await db.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return {
    db,
    async teardown() {
      await db.destroy();
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}
