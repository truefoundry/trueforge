import { sql, type Kysely } from 'kysely';

const OLD_NAME = 'default';
const NEW_NAME = 'trueforge-sandbox';

/**
 * Rename the reserved platform sandbox environment and every persisted name reference.
 *
 * Daytona snapshot refs are deliberately unchanged: `external_ref` is an opaque snapshot
 * identity and is not derived from the current environment name.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await sql`
    UPDATE sandbox_environment_version AS version
    SET manifest = jsonb_set(version.manifest, '{name}', to_jsonb(${NEW_NAME}::text))
    FROM sandbox_environment AS environment
    WHERE version.environment_id = environment.id
      AND environment.name = ${OLD_NAME}
  `.execute(db);

  await sql`
    UPDATE agent
    SET manifest = jsonb_set(manifest, '{config,sandbox,environment_name}', to_jsonb(${NEW_NAME}::text))
    WHERE manifest #>> '{config,sandbox,environment_name}' = ${OLD_NAME}
  `.execute(db);

  await sql`
    UPDATE session
    SET agent_spec = jsonb_set(agent_spec, '{config,sandbox,environment_name}', to_jsonb(${NEW_NAME}::text))
    WHERE agent_spec #>> '{config,sandbox,environment_name}' = ${OLD_NAME}
  `.execute(db);

  await sql`
    UPDATE sandbox_environment
    SET name = ${NEW_NAME}
    WHERE name = ${OLD_NAME}
  `.execute(db);
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await sql`
    UPDATE sandbox_environment_version AS version
    SET manifest = jsonb_set(version.manifest, '{name}', to_jsonb(${OLD_NAME}::text))
    FROM sandbox_environment AS environment
    WHERE version.environment_id = environment.id
      AND environment.name = ${NEW_NAME}
  `.execute(db);

  await sql`
    UPDATE agent
    SET manifest = jsonb_set(manifest, '{config,sandbox,environment_name}', to_jsonb(${OLD_NAME}::text))
    WHERE manifest #>> '{config,sandbox,environment_name}' = ${NEW_NAME}
  `.execute(db);

  await sql`
    UPDATE session
    SET agent_spec = jsonb_set(agent_spec, '{config,sandbox,environment_name}', to_jsonb(${OLD_NAME}::text))
    WHERE agent_spec #>> '{config,sandbox,environment_name}' = ${NEW_NAME}
  `.execute(db);

  await sql`
    UPDATE sandbox_environment
    SET name = ${OLD_NAME}
    WHERE name = ${NEW_NAME}
  `.execute(db);
}
