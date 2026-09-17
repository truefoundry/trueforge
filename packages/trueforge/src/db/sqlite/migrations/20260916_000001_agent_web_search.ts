import { type Kysely, sql } from 'kysely';

/**
 * Seed `config.web_search.enabled=false` on existing named agents.
 * Mirrors db/postgres/migrations/20260916_000001_agent_web_search.ts.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`
    UPDATE agent
    SET manifest = jsonb_set(
      coalesce(manifest, jsonb('{}')),
      '$.config',
      jsonb_patch(
        coalesce(jsonb_extract(manifest, '$.config'), jsonb('{}')),
        jsonb('{"web_search":{"enabled":false}}')
      )
    )
    WHERE json_extract(manifest, '$.config.web_search') IS NULL
  `.execute(db);
}

/** Remove the explicit web_search config block written by up. */
export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`
    UPDATE agent
    SET manifest = jsonb_remove(manifest, '$.config.web_search')
    WHERE json_extract(manifest, '$.config.web_search') IS NOT NULL
  `.execute(db);
}
