import { sql, type Kysely } from 'kysely';

/**
 * Session a schedule run created.
 * Backfills from `session.external_id`, which is the run id; runs without a session stay NULL.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('schedule_run').addColumn('session_id', 'text').execute();
  await sql`
    UPDATE schedule_run AS r
    SET session_id = s.session_id
    FROM session AS s
    WHERE s.tenant_id = r.tenant_id
      AND s.external_id = r.id
  `.execute(db);
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('schedule_run').dropColumn('session_id').execute();
}
