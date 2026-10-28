import { sql, type Kysely } from 'kysely';

/** Mirrors db/postgres/migrations/20261028_000003_access_control_tenant_backfill.ts. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      INSERT INTO access_control (tenant_id, session_id, subject_type, subject_id, granted_by_subject, created_at)
      SELECT tenant_id, session_id, 'tenant', tenant_id, created_by_subject, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM session
      WHERE shared = 1
      ON CONFLICT DO NOTHING
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE session
      SET shared = EXISTS (
        SELECT 1
        FROM access_control AS a
        WHERE a.tenant_id = session.tenant_id
          AND a.session_id = session.session_id
          AND a.subject_type = 'tenant'
          AND a.subject_id = session.tenant_id
      )
    `.execute(trx);
    await sql`DELETE FROM access_control WHERE subject_type = 'tenant'`.execute(trx);
  });
}
