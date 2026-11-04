import { sql, type Kysely } from 'kysely';

/** Prevent one subject from creating duplicate cron bindings for the same agent. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    CREATE UNIQUE INDEX schedule_cron_agent_creator_uq
      ON schedule (
        tenant_id,
        agent_name,
        (manifest->>'cron'),
        (created_by_subject->>'subject_id')
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS schedule_cron_agent_creator_uq`.execute(db);
}
