import { sql, type Kysely } from 'kysely';
import { planAgentNameHyphenRenames, type AgentNameRow } from '../../planAgentNameHyphenRenames';

/**
 * Rewrite agent names that contain "." or "_" to hyphen-only 2–64 form.
 * Updates `agent.name`, denormalized `session.agent_name`, and `schedule.agent_name`.
 * Binding is `schedule.agent_id` → `agent(id)` — no name FK to drop/recreate.
 * Irreversible: originals are not retained.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  try {
    await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

    const agents = await sql<AgentNameRow>`
      SELECT id, tenant_id, name FROM agent
    `.execute(db);
    const renames = planAgentNameHyphenRenames(agents.rows);
    if (renames.length === 0) {
      return;
    }

    for (const rename of renames) {
      await sql`
        UPDATE agent
        SET name = ${rename.to}, updated_at = now()
        WHERE id = ${rename.id}
      `.execute(db);
      await sql`
        UPDATE session
        SET agent_name = ${rename.to}
        WHERE tenant_id = ${rename.tenant_id} AND agent_name = ${rename.from}
      `.execute(db);
      await sql`
        UPDATE schedule
        SET agent_name = ${rename.to}
        WHERE tenant_id = ${rename.tenant_id} AND agent_name = ${rename.from}
      `.execute(db);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed agent name hyphen migration: ${detail}`, { cause: error });
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  return Promise.reject(new Error(`This migration is not reversible`));
}
