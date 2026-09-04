import { sql, type Kysely } from 'kysely';
import { planAgentNameHyphenRenames, type AgentNameRow } from '../../planAgentNameHyphenRenames';

/**
 * SQLite mirror of postgres/migrations/20260904_000002_agent_name_hyphen_only.ts.
 * Binding is `schedule.agent_id` → `agent(id)` — denormalized name updates need no FK toggle.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  try {
    const agents = await sql<AgentNameRow>`
      SELECT id, tenant_id, name FROM agent
    `.execute(db);
    const renames = planAgentNameHyphenRenames(agents.rows);
    if (renames.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    await db.transaction().execute(async trx => {
      for (const rename of renames) {
        await sql`
          UPDATE agent
          SET name = ${rename.to}, updated_at = ${now}
          WHERE id = ${rename.id}
        `.execute(trx);
        await sql`
          UPDATE session
          SET agent_name = ${rename.to}
          WHERE tenant_id = ${rename.tenant_id} AND agent_name = ${rename.from}
        `.execute(trx);
        await sql`
          UPDATE schedule
          SET agent_name = ${rename.to}
          WHERE tenant_id = ${rename.tenant_id} AND agent_name = ${rename.from}
        `.execute(trx);
      }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed agent name hyphen migration: ${detail}`, { cause: error });
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  void db;
  return Promise.reject(new Error(`This migration is not reversible`));
}
