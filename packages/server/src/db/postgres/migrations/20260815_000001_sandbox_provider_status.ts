import { sql, type Kysely } from 'kysely';

/**
 * Persist the release sandbox image build status alongside the provider config.
 * `status` defaults to 'pending' (a freshly configured provider is building);
 * `build_metadata` holds the build_ref + image_uri and is set on every upsert.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .alterTable('sandbox_provider')
    .addColumn('status', 'text', col => col.notNull().defaultTo('pending'))
    .addColumn('status_reason', 'text')
    .addColumn('build_metadata', 'jsonb', col => col.notNull().defaultTo(sql`'{}'::jsonb`))
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
