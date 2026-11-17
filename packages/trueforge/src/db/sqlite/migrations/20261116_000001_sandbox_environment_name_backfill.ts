import { sql, type Kysely } from 'kysely';

/**
 * SQLite mirror of postgres/20261116_000001_sandbox_environment_name_backfill.ts.
 * Pin missing sandbox environment names on agents and inline session specs.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE agent
      SET manifest = jsonb_set(
        manifest,
        '$.config.sandbox.environment_name',
        jsonb(json_quote(pin.name))
      )
      FROM (
        SELECT
          tenant_id,
          COALESCE(
            MAX(CASE WHEN is_default = 1 THEN name END),
            MAX(CASE WHEN name = 'trueforge-sandbox-env' THEN name END)
          ) AS name
        FROM sandbox_environment
        WHERE lifecycle_stage = 'active'
        GROUP BY tenant_id
      ) AS pin
      WHERE pin.tenant_id = agent.tenant_id
        AND pin.name IS NOT NULL
        AND json_extract(agent.manifest, '$.config.sandbox.enabled') IN (1, 'true')
        AND nullif(json_extract(agent.manifest, '$.config.sandbox.environment_name'), '') IS NULL
    `.execute(trx);

    await sql`
      UPDATE session
      SET agent_spec = jsonb_set(
        agent_spec,
        '$.config.sandbox.environment_name',
        jsonb(json_quote(pin.name))
      )
      FROM (
        SELECT
          tenant_id,
          COALESCE(
            MAX(CASE WHEN is_default = 1 THEN name END),
            MAX(CASE WHEN name = 'trueforge-sandbox-env' THEN name END)
          ) AS name
        FROM sandbox_environment
        WHERE lifecycle_stage = 'active'
        GROUP BY tenant_id
      ) AS pin
      WHERE pin.tenant_id = session.tenant_id
        AND pin.name IS NOT NULL
        AND session.agent_spec IS NOT NULL
        AND json_extract(session.agent_spec, '$.config.sandbox.enabled') IN (1, 'true')
        AND nullif(json_extract(session.agent_spec, '$.config.sandbox.environment_name'), '') IS NULL
    `.execute(trx);
  });
}

/** Irreversible: backfilled names are indistinguishable from user-pinned ones. */
export function down(db: Kysely<unknown>): Promise<void> {
  void db;
  return Promise.reject(new Error('20261116_000001_sandbox_environment_name_backfill is irreversible'));
}
