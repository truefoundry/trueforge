import { sql, type Kysely } from 'kysely';

/** Add caller-owned metadata to sandbox environments. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    ALTER TABLE sandbox_environment
      ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD CONSTRAINT sandbox_environment_metadata_object_check
        CHECK (jsonb_typeof(metadata) = 'object')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    ALTER TABLE sandbox_environment
      DROP CONSTRAINT IF EXISTS sandbox_environment_metadata_object_check,
      DROP COLUMN IF EXISTS metadata
  `.execute(db);
}
