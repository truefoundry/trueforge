import { sql, type Kysely } from 'kysely';

/**
 * Persist the release sandbox image build status alongside the provider config.
 * `build_metadata` is nullable opaque jsonb (build_ref + image_uri when present).
 *
 * `status` keeps the 'pending' default here: SQLite cannot drop a column default
 * without rebuilding the table, and it is harmless because every upsert writes
 * status explicitly (Postgres drops the default after backfill).
 *
 * Existing rows already have an active snapshot named in the legacy
 * `manifest.snapshot_name`; backfill them as ready with that name as build_ref.
 * The image_uri is captured as the release image at the time of this migration.
 */
const RELEASE_IMAGE_URI =
  'tfy.jfrog.io/tfy-images/truefoundry-utils-core-sandbox:029ea5ff6438cf86b79282e087bfc17528067946';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE sandbox_provider ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`.execute(trx);
    await sql`ALTER TABLE sandbox_provider ADD COLUMN status_reason TEXT`.execute(trx);
    // Nullable: SQLite forbids non-constant DEFAULTs on ADD COLUMN when rows exist.
    await sql`ALTER TABLE sandbox_provider ADD COLUMN build_metadata BLOB`.execute(trx);

    await sql`
      UPDATE sandbox_provider
      SET status = 'ready',
          build_metadata = jsonb(json_object(
            'build_ref', json_extract(json(manifest), '$.snapshot_name'),
            'image_uri', ${RELEASE_IMAGE_URI}
          ))
      WHERE json_extract(json(manifest), '$.snapshot_name') IS NOT NULL
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE sandbox_provider DROP COLUMN build_metadata`.execute(trx);
    await sql`ALTER TABLE sandbox_provider DROP COLUMN status_reason`.execute(trx);
    await sql`ALTER TABLE sandbox_provider DROP COLUMN status`.execute(trx);
  });
}
