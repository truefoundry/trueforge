import { sql, type Kysely } from 'kysely';

/**
 * Pin missing `config.sandbox.environment_name` on saved agents and inline
 * session specs when sandbox is enabled.
 *
 * Before 2026-11-10 the field was optional (omit meant "tenant default").
 * Validation now requires it for Daytona, which 422s those legacy rows at
 * session create. Prefer the tenant `is_default` environment; fall back to the
 * reserved `trueforge-sandbox-env` when that row exists and no default is set.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await sql`
    UPDATE agent AS agent
    SET manifest = jsonb_set(
      agent.manifest,
      '{config,sandbox,environment_name}',
      to_jsonb(pin.name)
    )
    FROM (
      SELECT
        tenant_id,
        COALESCE(
          MAX(name) FILTER (WHERE is_default),
          MAX(name) FILTER (WHERE name = 'trueforge-sandbox-env')
        ) AS name
      FROM sandbox_environment
      WHERE lifecycle_stage = 'active'
      GROUP BY tenant_id
    ) AS pin
    WHERE pin.tenant_id = agent.tenant_id
      AND pin.name IS NOT NULL
      AND (agent.manifest #>> '{config,sandbox,enabled}') = 'true'
      AND nullif(agent.manifest #>> '{config,sandbox,environment_name}', '') IS NULL
  `.execute(db);

  await sql`
    UPDATE session AS session
    SET agent_spec = jsonb_set(
      session.agent_spec,
      '{config,sandbox,environment_name}',
      to_jsonb(pin.name)
    )
    FROM (
      SELECT
        tenant_id,
        COALESCE(
          MAX(name) FILTER (WHERE is_default),
          MAX(name) FILTER (WHERE name = 'trueforge-sandbox-env')
        ) AS name
      FROM sandbox_environment
      WHERE lifecycle_stage = 'active'
      GROUP BY tenant_id
    ) AS pin
    WHERE pin.tenant_id = session.tenant_id
      AND pin.name IS NOT NULL
      AND session.agent_spec IS NOT NULL
      AND (session.agent_spec #>> '{config,sandbox,enabled}') = 'true'
      AND nullif(session.agent_spec #>> '{config,sandbox,environment_name}', '') IS NULL
  `.execute(db);
}

/** Irreversible: backfilled names are indistinguishable from user-pinned ones. */
export function down(db: Kysely<unknown>): Promise<void> {
  void db;
  return Promise.reject(new Error('20261116_000001_sandbox_environment_name_backfill is irreversible'));
}
