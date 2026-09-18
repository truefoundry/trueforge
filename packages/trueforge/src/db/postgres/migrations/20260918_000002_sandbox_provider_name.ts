import { sql, type Kysely } from 'kysely';

import { SANDBOX_PROVIDER_TENANT_NAME_UQ } from '../../indexes';

/**
 * Persist sandbox provider identity `name` (always equal to `manifest.type` for now).
 * Backfill existing rows from the jsonb type, then require NOT NULL and
 * UNIQUE (tenant_id, name).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('sandbox_provider').addColumn('name', 'text').execute();

  await sql`
    UPDATE sandbox_provider
    SET name = manifest ->> 'type'
    WHERE name IS NULL
  `.execute(db);

  await sql`
    ALTER TABLE sandbox_provider
    ALTER COLUMN name SET NOT NULL
  `.execute(db);

  await db.schema
    .alterTable('sandbox_provider')
    .addUniqueConstraint(SANDBOX_PROVIDER_TENANT_NAME_UQ, ['tenant_id', 'name'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('sandbox_provider').dropConstraint(SANDBOX_PROVIDER_TENANT_NAME_UQ).execute();
  await db.schema.alterTable('sandbox_provider').dropColumn('name').execute();
}
