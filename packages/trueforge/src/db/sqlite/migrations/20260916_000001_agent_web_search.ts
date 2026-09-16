import { type Kysely, sql } from 'kysely';

/**
 * Disable built-in web search on existing named agents and inline session specs (schema default is enabled).
 * Mirrors db/postgres/migrations/20260916_000001_agent_web_search.ts.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async transaction => {
    // Seed config when absent, then merge web_search (parity with Postgres).
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
  `.execute(transaction);
    await sql`
    UPDATE session
    SET agent_spec = jsonb_set(
      agent_spec,
      '$.config',
      jsonb_patch(
        coalesce(jsonb_extract(agent_spec, '$.config'), jsonb('{}')),
        jsonb('{"web_search":{"enabled":false}}')
      )
    )
    WHERE agent_spec IS NOT NULL
  `.execute(transaction);
  });
}

/** Remove the explicit web_search config block written by up. */
export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async transaction => {
    await sql`
    UPDATE agent
    SET manifest = jsonb_remove(manifest, '$.config.web_search')
    WHERE json_extract(manifest, '$.config.web_search') IS NOT NULL
  `.execute(transaction);
    await sql`
    UPDATE session
    SET agent_spec = jsonb_remove(agent_spec, '$.config.web_search')
    WHERE agent_spec IS NOT NULL
      AND json_extract(agent_spec, '$.config.web_search') IS NOT NULL
  `.execute(transaction);
  });
}
