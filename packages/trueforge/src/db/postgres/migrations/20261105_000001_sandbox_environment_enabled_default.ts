import { sql, type Kysely } from 'kysely';
import { SANDBOX_ENVIRONMENT_TENANT_DEFAULT_UQ } from '../../indexes';

/**
 * Per-environment `enabled` switch and the tenant `is_default` flag.
 *
 * Standalone tenants already persist a reserved row named `default`; the UPDATE below
 * backfills `is_default` onto those rows. TrueFoundry+Daytona had no DB row before this
 * change (it was synthesized in memory), so that path materialises and claims on get/list
 * instead — this UPDATE is a no-op for those tenants.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await sql`
    ALTER TABLE sandbox_environment
      ADD COLUMN enabled boolean NOT NULL DEFAULT true,
      ADD COLUMN is_default boolean NOT NULL DEFAULT false
  `.execute(db);

  // Standalone backfill: existing reserved rows become the tenant default.
  await sql`
    UPDATE sandbox_environment
    SET is_default = true
    WHERE name = 'default' AND lifecycle_stage = 'active'
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_TENANT_DEFAULT_UQ)}
      ON sandbox_environment (tenant_id)
      WHERE is_default
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await sql`DROP INDEX IF EXISTS ${sql.raw(SANDBOX_ENVIRONMENT_TENANT_DEFAULT_UQ)}`.execute(db);
  await sql`
    ALTER TABLE sandbox_environment
      DROP COLUMN IF EXISTS is_default,
      DROP COLUMN IF EXISTS enabled
  `.execute(db);
}
