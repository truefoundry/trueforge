import { sql, type Kysely } from 'kysely';

/**
 * Sessions shared with everyone become `tenant` grants; `session.shared` is no longer read or written.
 * Down copies tenant grants back onto the column so a rollback keeps sharing intact.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    INSERT INTO access_control (tenant_id, session_id, subject_type, subject_id, granted_by_subject, created_at)
    SELECT tenant_id, session_id, 'tenant', tenant_id, created_by_subject, now()
    FROM session
    WHERE shared
    ON CONFLICT DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE session AS s
    SET shared = EXISTS (
      SELECT 1
      FROM access_control AS a
      WHERE a.tenant_id = s.tenant_id
        AND a.session_id = s.session_id
        AND a.subject_type = 'tenant'
        AND a.subject_id = s.tenant_id
    )
  `.execute(db);
  await sql`DELETE FROM access_control WHERE subject_type = 'tenant'`.execute(db);
}
