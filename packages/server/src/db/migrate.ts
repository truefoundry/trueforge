import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Kysely } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';

import type { Database } from './types';

/**
 * Runs all pending migrations. On Postgres this executes inside one
 * transaction (Kysely default) unless `disableTransactions` is set — never set that.
 */
export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      // Absolute path required.
      // Dev (tsx): this file lives in src/db → src/db/migrations
      // Prod (bundled into dist/main.js): import.meta.dirname is dist → dist/migrations
      migrationFolder: path.join(import.meta.dirname, 'migrations'),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

  results?.forEach(it => {
    if (it.status === 'Success') {
      console.log(`migration "${it.migrationName}" was executed successfully`);
    } else if (it.status === 'Error') {
      console.error(`failed to execute migration "${it.migrationName}"`);
    }
  });

  if (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('failed to migrate', { cause: error });
  }
}
