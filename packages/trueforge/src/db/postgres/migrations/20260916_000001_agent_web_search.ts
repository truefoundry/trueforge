import { sql, type Kysely } from 'kysely';

/** Disable built-in web search on existing named agents and inline session specs (schema default is enabled). */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  // jsonb_set only creates the last path element; seed config when absent.
  await sql`
    UPDATE agent
    SET manifest = jsonb_set(
      jsonb_set(
        coalesce(manifest, '{}'::jsonb),
        '{config}',
        coalesce(manifest->'config', '{}'::jsonb),
        true
      ),
      '{config,web_search}',
      '{"enabled":false}'::jsonb,
      true
    );
    UPDATE session
    SET agent_spec = jsonb_set(
      jsonb_set(
        agent_spec,
        '{config}',
        coalesce(agent_spec->'config', '{}'::jsonb),
        true
      ),
      '{config,web_search}',
      '{"enabled":false}'::jsonb,
      true
    )
    WHERE agent_spec IS NOT NULL
  `.execute(db);
}

/** Remove the explicit web_search config block written by up. */
export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE agent
    SET manifest = manifest #- '{config,web_search}'
    WHERE manifest ? 'config';
    UPDATE session
    SET agent_spec = agent_spec #- '{config,web_search}'
    WHERE agent_spec IS NOT NULL
  `.execute(db);
}
