import { sql, type Kysely } from 'kysely';
import { SCHEDULE_CRON_AGENT_CREATOR_UQ } from '../../indexes';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async transaction => {
    await sql`
      CREATE UNIQUE INDEX ${sql.raw(SCHEDULE_CRON_AGENT_CREATOR_UQ)}
        ON schedule (
          tenant_id,
          agent_name,
          json_extract(manifest, '$.cron'),
          json_extract(created_by_subject, '$.subject_id')
        )
    `.execute(transaction);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async transaction => {
    await sql`DROP INDEX IF EXISTS ${sql.raw(SCHEDULE_CRON_AGENT_CREATOR_UQ)}`.execute(transaction);
  });
}
