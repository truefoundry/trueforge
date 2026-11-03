import { promises as fs } from 'node:fs';
import path from 'node:path';

import { sql, type Kysely } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { isTrueFoundryModeEnabled } from '../config';
import { importAbsoluteModule } from '../util/crossPlatform';
import { getTrueForgePostgresSchema } from './postgres/schema';
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
    migrationTableSchema: getTrueForgePostgresSchema(),
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
 * Relabels stored sandbox environment versions as `type: truefoundry`; `sandbox_provider` is untouched.
 * Idempotent, so it runs on every TrueFoundry-mode boot (covers deployments switched into the mode later).
 */
export async function backfillTrueFoundrySandboxEnvironmentType(db: Kysely<Database>): Promise<number> {
  return db.transaction().execute(async transaction => {
    await sql`SET LOCAL lock_timeout = '5s'`.execute(transaction);
    const result = await sql`
      UPDATE sandbox_environment_version
      SET manifest = jsonb_set(manifest, '{type}', '"truefoundry"'::jsonb)
      WHERE manifest->>'type' IS DISTINCT FROM 'truefoundry'
    `.execute(transaction);
    return Number(result.numAffectedRows ?? 0n);
  });
}

/**
 * Runs all pending Postgres migrations, then the TrueFoundry-mode sandbox environment backfill.
 *
 * This module lives at `src/db/` (bundled into `dist/main.js`) so the folder is
 * always `…/postgres/migrations` — source or production.
 */
export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  await runMigrations({ db, targetMigrationName: undefined });
  if (isTrueFoundryModeEnabled()) {
    const updated = await backfillTrueFoundrySandboxEnvironmentType(db);
    if (updated > 0) {
      console.log(`relabeled ${String(updated)} sandbox environment version(s) as type "truefoundry"`);
    }
  }
}

/** Runs Postgres migrations up to and including the named migration. */
export async function migrateTo(db: Kysely<Database>, targetMigrationName: string): Promise<void> {
  await runMigrations({ db, targetMigrationName });
}
