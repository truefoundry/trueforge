import { sql, type Kysely } from 'kysely';

const OLD_NAME = 'default';
const NEW_NAME = 'trueforge-sandbox-env';

/**
 * SQLite mirror of postgres/20261110_000001_trueforge_sandbox_name.ts.
 * Daytona snapshot refs remain unchanged because they are opaque external identities.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE sandbox_environment_version
      SET manifest = jsonb_set(manifest, '$.name', ${NEW_NAME})
      WHERE environment_id IN (
        SELECT id
        FROM sandbox_environment
        WHERE name = ${OLD_NAME}
      )
    `.execute(trx);

    await sql`
      UPDATE agent
      SET manifest = jsonb_set(manifest, '$.config.sandbox.environment_name', ${NEW_NAME})
      WHERE json_extract(manifest, '$.config.sandbox.environment_name') = ${OLD_NAME}
    `.execute(trx);

    await sql`
      UPDATE session
      SET agent_spec = jsonb_set(agent_spec, '$.config.sandbox.environment_name', ${NEW_NAME})
      WHERE json_extract(agent_spec, '$.config.sandbox.environment_name') = ${OLD_NAME}
    `.execute(trx);

    await sql`
      UPDATE sandbox_environment
      SET name = ${NEW_NAME}
      WHERE name = ${OLD_NAME}
    `.execute(trx);
  });
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE sandbox_environment_version
      SET manifest = jsonb_set(manifest, '$.name', ${OLD_NAME})
      WHERE environment_id IN (
        SELECT id
        FROM sandbox_environment
        WHERE name = ${NEW_NAME}
      )
    `.execute(trx);

    await sql`
      UPDATE agent
      SET manifest = jsonb_set(manifest, '$.config.sandbox.environment_name', ${OLD_NAME})
      WHERE json_extract(manifest, '$.config.sandbox.environment_name') = ${NEW_NAME}
    `.execute(trx);

    await sql`
      UPDATE session
      SET agent_spec = jsonb_set(agent_spec, '$.config.sandbox.environment_name', ${OLD_NAME})
      WHERE json_extract(agent_spec, '$.config.sandbox.environment_name') = ${NEW_NAME}
    `.execute(trx);

    await sql`
      UPDATE sandbox_environment
      SET name = ${OLD_NAME}
      WHERE name = ${NEW_NAME}
    `.execute(trx);
  });
}
