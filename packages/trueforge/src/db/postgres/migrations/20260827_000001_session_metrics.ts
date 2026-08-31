import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .alterTable('session')
    .addColumn('metrics', 'jsonb', col =>
      col.notNull().defaultTo(sql`'{"total_cost_in_usd":0,"total_duration_ms":0,"total_turns":0}'::jsonb`),
    )
    .execute();
  // Serves GET /sessions/metrics (named agent + created_at window).
  // session_agent_id_idx cannot range on created_at; partial skips inline sessions.
  await sql`
    CREATE INDEX session_agent_created_at_idx
      ON session (tenant_id, agent_id, created_at)
      WHERE agent_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS session_agent_created_at_idx`.execute(db);
  await db.schema.alterTable('session').dropColumn('metrics').execute();
}
