import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Kysely } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';

import { importAbsoluteModule } from '../util/crossPlatform';
import type { Database } from './postgres/types';

function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      import: importAbsoluteModule,
      migrationFolder: path.join(import.meta.dirname, 'postgres', 'migrations'),
    }),
  });
}

async function runMigrations(input: { db: Kysely<Database>; targetMigrationName: string | undefined }): Promise<void> {
  const migrator = createMigrator(input.db);

  const { error, results } =
    input.targetMigrationName === undefined
      ? await migrator.migrateToLatest()
      : await migrator.migrateTo(input.targetMigrationName);

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

/**
 * Runs all pending Postgres migrations.
 *
 * This module lives at `src/db/` (bundled into `dist/main.js`) so the folder is
 * always `…/postgres/migrations` — source or production.
 */
export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  await runMigrations({ db, targetMigrationName: undefined });
}

/** Runs Postgres migrations up to and including the named migration. */
export async function migrateTo(db: Kysely<Database>, targetMigrationName: string): Promise<void> {
  await runMigrations({ db, targetMigrationName });
}
