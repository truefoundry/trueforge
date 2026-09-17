import { sql, type Kysely } from 'kysely';

/** Seed `config.web_search.enabled=false` on existing named agents. */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  // Seed config when absent, then merge web_search (jsonb_set alone only creates the last path element).
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE agent
    SET manifest = jsonb_set(
      coalesce(manifest, '{}'::jsonb),
      '{config}',
      coalesce(manifest->'config', '{}'::jsonb) || '{"web_search":{"enabled":false}}'::jsonb,
      true
    )
    WHERE manifest->'config'->'web_search' IS NULL
  `.execute(db);
}

/** Remove the explicit web_search config block written by up. */
export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE agent
    SET manifest = manifest #- '{config,web_search}'
    WHERE manifest ? 'config'
  `.execute(db);
}
