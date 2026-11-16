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
        jsonb(json_quote((
          SELECT COALESCE(
            (
              SELECT env.name
              FROM sandbox_environment AS env
              WHERE env.tenant_id = agent.tenant_id
                AND env.lifecycle_stage = 'active'
                AND env.is_default = 1
              LIMIT 1
            ),
            (
              SELECT env.name
              FROM sandbox_environment AS env
              WHERE env.tenant_id = agent.tenant_id
                AND env.lifecycle_stage = 'active'
                AND env.name = 'trueforge-sandbox-env'
              LIMIT 1
            )
          )
        )))
      )
      WHERE json_extract(manifest, '$.config.sandbox.enabled') IN (1, 'true')
        AND nullif(json_extract(manifest, '$.config.sandbox.environment_name'), '') IS NULL
        AND (
          SELECT COALESCE(
            (
              SELECT env.name
              FROM sandbox_environment AS env
              WHERE env.tenant_id = agent.tenant_id
                AND env.lifecycle_stage = 'active'
                AND env.is_default = 1
              LIMIT 1
            ),
            (
              SELECT env.name
              FROM sandbox_environment AS env
              WHERE env.tenant_id = agent.tenant_id
                AND env.lifecycle_stage = 'active'
                AND env.name = 'trueforge-sandbox-env'
              LIMIT 1
            )
          )
        ) IS NOT NULL
    `.execute(trx);

    await sql`
      UPDATE session
      SET agent_spec = jsonb_set(
        agent_spec,
        '$.config.sandbox.environment_name',
        jsonb(json_quote((
          SELECT COALESCE(
            (
              SELECT env.name
              FROM sandbox_environment AS env
              WHERE env.tenant_id = session.tenant_id
                AND env.lifecycle_stage = 'active'
                AND env.is_default = 1
              LIMIT 1
            ),
            (
              SELECT env.name
              FROM sandbox_environment AS env
              WHERE env.tenant_id = session.tenant_id
                AND env.lifecycle_stage = 'active'
                AND env.name = 'trueforge-sandbox-env'
              LIMIT 1
            )
          )
        )))
      )
      WHERE agent_spec IS NOT NULL
        AND json_extract(agent_spec, '$.config.sandbox.enabled') IN (1, 'true')
        AND nullif(json_extract(agent_spec, '$.config.sandbox.environment_name'), '') IS NULL
        AND (
          SELECT COALESCE(
            (
              SELECT env.name
              FROM sandbox_environment AS env
              WHERE env.tenant_id = session.tenant_id
                AND env.lifecycle_stage = 'active'
                AND env.is_default = 1
              LIMIT 1
            ),
            (
              SELECT env.name
              FROM sandbox_environment AS env
              WHERE env.tenant_id = session.tenant_id
                AND env.lifecycle_stage = 'active'
                AND env.name = 'trueforge-sandbox-env'
              LIMIT 1
            )
          )
        ) IS NOT NULL
    `.execute(trx);
  });
}

/** Irreversible: backfilled names are indistinguishable from user-pinned ones. */
export function down(db: Kysely<unknown>): Promise<void> {
  void db;
  return Promise.reject(new Error('20261116_000001_sandbox_environment_name_backfill is irreversible'));
}
