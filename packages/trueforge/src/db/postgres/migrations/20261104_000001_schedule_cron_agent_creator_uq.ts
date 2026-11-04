import { sql, type Kysely } from 'kysely';
import { SCHEDULE_CRON_AGENT_CREATOR_UQ } from '../../indexes';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    CREATE UNIQUE INDEX ${sql.raw(SCHEDULE_CRON_AGENT_CREATOR_UQ)}
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
  await sql`DROP INDEX IF EXISTS ${sql.raw(SCHEDULE_CRON_AGENT_CREATOR_UQ)}`.execute(db);
}
