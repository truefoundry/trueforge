import { sql, type Kysely } from 'kysely';

/**
 * Persist the release sandbox image build status alongside the provider config.
 * `build_metadata` is nullable opaque jsonb (build_ref + image_uri when present).
 *
 * `status` is added with a temporary 'pending' default so the NOT NULL column can
 * be backfilled on existing rows, then the default is dropped — every upsert writes
 * status explicitly, so the DB should never silently fall back to 'pending'.
 *
 * Existing rows already have an active snapshot named in the legacy
 * `manifest.snapshot_name`; backfill them as ready with that name as build_ref.
 * The image_uri is captured as the release image at the time of this migration.
 */
const RELEASE_IMAGE_URI =
  'tfy.jfrog.io/tfy-images/truefoundry-utils-core-sandbox:029ea5ff6438cf86b79282e087bfc17528067946';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .alterTable('sandbox_provider')
    .addColumn('status', 'text', col => col.notNull().defaultTo('pending'))
    .addColumn('status_reason', 'text')
    .addColumn('build_metadata', 'jsonb')
    .execute();

  await sql`
    UPDATE sandbox_provider
    SET status = 'ready',
        build_metadata = jsonb_build_object(
          'build_ref', manifest ->> 'snapshot_name',
          'image_uri', ${RELEASE_IMAGE_URI}::text
        )
    WHERE manifest ->> 'snapshot_name' IS NOT NULL
  `.execute(db);

  await db.schema
    .alterTable('sandbox_provider')
    .alterColumn('status', col => col.dropDefault())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .alterTable('sandbox_provider')
    .dropColumn('build_metadata')
    .dropColumn('status_reason')
    .dropColumn('status')
    .execute();
}
