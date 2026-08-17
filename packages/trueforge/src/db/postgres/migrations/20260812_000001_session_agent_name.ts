import { sql, type Kysely } from 'kysely';

/**
 * Create-time snapshot of registry agent name on named sessions.
 * Backfills from `agent.name` where `session.agent_id` still resolves;
 * orphan refs stay NULL.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('session').addColumn('agent_name', 'text').execute();
  await sql`
    UPDATE session AS s
    SET agent_name = a.name
    FROM agent AS a
    WHERE s.agent_id = a.id
      AND s.tenant_id = a.tenant_id
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('session').dropColumn('agent_name').execute();
}
