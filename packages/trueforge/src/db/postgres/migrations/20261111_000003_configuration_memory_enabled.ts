import { sql, type Kysely } from 'kysely';

/**
 * Turn memory on for every tenant. Existing rows get the switch on; tenants that already have
 * sessions but no row get the default row, since memory ingestion lists tenants from stored rows.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE configuration
    SET manifest = jsonb_set(manifest, '{memory}', '{"enabled":true}'::jsonb, true)
  `.execute(db);
  await sql`
    INSERT INTO configuration (tenant_id, manifest, updated_at)
    SELECT DISTINCT tenant_id, '{"web_search":{"enabled":true},"memory":{"enabled":true}}'::jsonb, now()
    FROM session
    ON CONFLICT (tenant_id) DO NOTHING
  `.execute(db);
}

/** Irreversible: the switch values before `up` are not recoverable. */
export function down(): Promise<void> {
  return Promise.reject(new Error('20261111_000003_configuration_memory_enabled is not reversible'));
}
