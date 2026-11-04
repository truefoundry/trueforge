import { sql, type Kysely } from 'kysely';

/** Mirrors the Postgres uniqueness rule for schedule cron, agent, and creator. */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE UNIQUE INDEX schedule_cron_agent_creator_uq
        ON schedule (
          tenant_id,
          agent_name,
          json_extract(manifest, '$.cron'),
          json_extract(created_by_subject, '$.subject_id')
        )
    `.execute(trx);
  });
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP INDEX IF EXISTS schedule_cron_agent_creator_uq`.execute(trx);
  });
}
