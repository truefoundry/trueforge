import { sql, type Kysely } from 'kysely';

/**
 * Mirrors db/postgres/migrations/20261016_000001_schedule_run_session_id.ts.
 * Backfills from `session.external_id`, which is the run id; runs without a session stay NULL.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      ALTER TABLE schedule_run
        ADD COLUMN session_id TEXT
    `.execute(trx);
    await sql`
      UPDATE schedule_run
      SET session_id = (
        SELECT s.session_id
        FROM session AS s
        WHERE s.tenant_id = schedule_run.tenant_id
          AND s.external_id = schedule_run.id
      )
    `.execute(trx);
  });
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  void db;
  return Promise.reject(new Error('20261016_000001_schedule_run_session_id is not reversible'));
}
