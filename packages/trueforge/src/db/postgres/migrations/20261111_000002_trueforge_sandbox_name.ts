import { sql, type Kysely } from 'kysely';

const OLD_NAME = 'default';
const NEW_NAME = 'trueforge-sandbox-env';
const RANDOM_SUFFIX_ATTEMPTS = 100;

/**
 * Rename the reserved platform sandbox environment and every persisted name reference.
 * If a tenant already has an active environment using the destination name, preserve it
 * under `<name>-NNNNNN` before the reserved environment claims the name.
 *
 * Daytona snapshot refs are deliberately unchanged: `external_ref` is an opaque snapshot
 * identity and is not derived from the current environment name.
 */
function randomSuffixedName(name: string): string {
  const suffix = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return `${name}-${suffix}`;
}

async function renameReservedEnvironment<TDatabase>({
  db,
  fromName,
  toName,
}: {
  db: Kysely<TDatabase>;
  fromName: string;
  toName: string;
}): Promise<void> {
  const conflicts = await sql<{ id: string; tenant_id: string }>`
    SELECT destination.id, destination.tenant_id
    FROM sandbox_environment AS destination
    WHERE destination.name = ${toName}
      AND destination.lifecycle_stage = 'active'
      AND EXISTS (
        SELECT 1
        FROM sandbox_environment AS reserved
        WHERE reserved.tenant_id = destination.tenant_id
          AND reserved.name = ${fromName}
          AND reserved.lifecycle_stage = 'active'
      )
  `.execute(db);

  for (const conflict of conflicts.rows) {
    let replacementName: string | undefined;
    for (let attempt = 0; attempt < RANDOM_SUFFIX_ATTEMPTS; attempt += 1) {
      const candidate = randomSuffixedName(toName);
      const existing = await sql`
        SELECT 1
        FROM sandbox_environment
        WHERE tenant_id = ${conflict.tenant_id}
          AND name = ${candidate}
          AND lifecycle_stage = 'active'
        LIMIT 1
      `.execute(db);
      if (existing.rows.length === 0) {
        replacementName = candidate;
        break;
      }
    }
    if (replacementName === undefined) {
      throw new Error(`Could not allocate a unique six-digit suffix for sandbox environment "${toName}"`);
    }

    await sql`
      UPDATE sandbox_environment
      SET name = ${replacementName}
      WHERE id = ${conflict.id}
    `.execute(db);
    await sql`
      UPDATE sandbox_environment_version
      SET manifest = jsonb_set(manifest, '{name}', to_jsonb(${replacementName}::text))
      WHERE environment_id = ${conflict.id}
    `.execute(db);
    await sql`
      UPDATE agent
      SET manifest = jsonb_set(manifest, '{config,sandbox,environment_name}', to_jsonb(${replacementName}::text))
      WHERE tenant_id = ${conflict.tenant_id}
        AND manifest #>> '{config,sandbox,environment_name}' = ${toName}
    `.execute(db);
    await sql`
      UPDATE session
      SET agent_spec = jsonb_set(agent_spec, '{config,sandbox,environment_name}', to_jsonb(${replacementName}::text))
      WHERE tenant_id = ${conflict.tenant_id}
        AND agent_spec #>> '{config,sandbox,environment_name}' = ${toName}
    `.execute(db);
  }

  await sql`
    UPDATE sandbox_environment_version AS version
    SET manifest = jsonb_set(version.manifest, '{name}', to_jsonb(${toName}::text))
    FROM sandbox_environment AS environment
    WHERE version.environment_id = environment.id
      AND environment.name = ${fromName}
      AND environment.lifecycle_stage = 'active'
  `.execute(db);
  await sql`
    UPDATE agent AS agent
    SET manifest = jsonb_set(agent.manifest, '{config,sandbox,environment_name}', to_jsonb(${toName}::text))
    WHERE agent.manifest #>> '{config,sandbox,environment_name}' = ${fromName}
      AND EXISTS (
        SELECT 1
        FROM sandbox_environment AS environment
        WHERE environment.tenant_id = agent.tenant_id
          AND environment.name = ${fromName}
          AND environment.lifecycle_stage = 'active'
      )
  `.execute(db);
  await sql`
    UPDATE session AS session
    SET agent_spec = jsonb_set(session.agent_spec, '{config,sandbox,environment_name}', to_jsonb(${toName}::text))
    WHERE session.agent_spec #>> '{config,sandbox,environment_name}' = ${fromName}
      AND EXISTS (
        SELECT 1
        FROM sandbox_environment AS environment
        WHERE environment.tenant_id = session.tenant_id
          AND environment.name = ${fromName}
          AND environment.lifecycle_stage = 'active'
      )
  `.execute(db);
  await sql`
    UPDATE sandbox_environment
    SET name = ${toName}
    WHERE name = ${fromName}
      AND lifecycle_stage = 'active'
  `.execute(db);
}

export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await renameReservedEnvironment({ db, fromName: OLD_NAME, toName: NEW_NAME });
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await renameReservedEnvironment({ db, fromName: NEW_NAME, toName: OLD_NAME });
}
