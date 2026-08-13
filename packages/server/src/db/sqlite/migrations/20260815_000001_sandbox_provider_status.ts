import { sql, type Kysely } from 'kysely';

/**
 * Persist the release sandbox image build status alongside the provider config.
 * `status` defaults to 'pending' (a freshly configured provider is building);
 * `build_metadata` holds the build_ref + image_uri and is set on every upsert.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sandbox_provider ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`.execute(db);
  await sql`ALTER TABLE sandbox_provider ADD COLUMN status_reason TEXT`.execute(db);
  await sql`ALTER TABLE sandbox_provider ADD COLUMN build_metadata BLOB NOT NULL DEFAULT (jsonb('{}'))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sandbox_provider DROP COLUMN build_metadata`.execute(db);
  await sql`ALTER TABLE sandbox_provider DROP COLUMN status_reason`.execute(db);
  await sql`ALTER TABLE sandbox_provider DROP COLUMN status`.execute(db);
}
