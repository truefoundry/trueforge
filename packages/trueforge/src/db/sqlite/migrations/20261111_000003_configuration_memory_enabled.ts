import { type Kysely, sql } from 'kysely';

/**
 * Turn memory on for every tenant. Existing rows get the switch on; tenants that already have
 * sessions but no row get the default row, since memory ingestion lists tenants from stored rows.
 * Mirrors db/postgres/migrations/20261111_000003_configuration_memory_enabled.ts.
 * Kysely does not wrap SQLite migrations — keep both statements in one transaction.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE configuration
      SET manifest = jsonb_set(manifest, '$.memory', jsonb('{"enabled":true}'))
    `.execute(trx);
    await sql`
      INSERT OR IGNORE INTO configuration (tenant_id, manifest, updated_at)
      SELECT DISTINCT tenant_id, jsonb('{"web_search":{"enabled":true},"memory":{"enabled":true}}'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM session
    `.execute(trx);
  });
}

/** Irreversible: the switch values before `up` are not recoverable. */
export function down(): Promise<void> {
  return Promise.reject(new Error('20261111_000003_configuration_memory_enabled is not reversible'));
}
