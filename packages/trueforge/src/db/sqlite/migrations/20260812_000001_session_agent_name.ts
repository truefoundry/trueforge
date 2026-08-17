import { sql, type Kysely } from 'kysely';

/**
 * Create-time snapshot of registry agent name on named sessions.
 * Backfills from `agent.name` where `session.agent_id` still resolves;
 * orphan refs stay NULL.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      ALTER TABLE session
        ADD COLUMN agent_name TEXT
    `.execute(trx);
    await sql`
      UPDATE session
      SET agent_name = (
        SELECT a.name
        FROM agent AS a
        WHERE a.id = session.agent_id
          AND a.tenant_id = session.tenant_id
      )
      WHERE agent_id IS NOT NULL
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // SQLite cannot DROP COLUMN under STRICT without a table rebuild; irreversible.
  void db;
  return Promise.reject(new Error('20260812_000001_session_agent_name is not reversible'));
}
