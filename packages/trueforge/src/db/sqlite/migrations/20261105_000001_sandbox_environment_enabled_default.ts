import { sql, type Kysely } from 'kysely';
import { SANDBOX_ENVIRONMENT_TENANT_DEFAULT_UQ } from '../../indexes';

/**
 * Mirrors db/postgres/migrations/20261105_000001_sandbox_environment_enabled_default.ts.
 * STRICT has no boolean, so both flags are INTEGER 0/1.
 * Kysely does not wrap SQLite migrations — keep schema changes in a transaction.
 *
 * Standalone tenants already persist a reserved row named `default`; the UPDATE below
 * backfills `is_default` onto those rows. TrueFoundry+Daytona had no DB row before this
 * change (it was synthesized in memory), so that path materialises and claims on get/list
 * instead — this UPDATE is a no-op for those tenants.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      ALTER TABLE sandbox_environment
        ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1
    `.execute(trx);

    await sql`
      ALTER TABLE sandbox_environment
        ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0
    `.execute(trx);

    // Standalone backfill: existing reserved rows become the tenant default.
    await sql`
      UPDATE sandbox_environment
      SET is_default = 1
      WHERE name = 'default' AND lifecycle_stage = 'active'
    `.execute(trx);

    await sql`
      CREATE UNIQUE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_TENANT_DEFAULT_UQ)}
        ON sandbox_environment (tenant_id)
        WHERE is_default = 1
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP INDEX IF EXISTS ${sql.raw(SANDBOX_ENVIRONMENT_TENANT_DEFAULT_UQ)}`.execute(trx);
    await sql`ALTER TABLE sandbox_environment DROP COLUMN is_default`.execute(trx);
    await sql`ALTER TABLE sandbox_environment DROP COLUMN enabled`.execute(trx);
  });
}
