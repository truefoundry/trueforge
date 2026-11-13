import { sql, type Kysely } from 'kysely';

/**
 * Drop session.shared — tenant sharing lives in access_control grants since the
 * 20261028 backfill; application code no longer reads or writes this column.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE session DROP COLUMN IF EXISTS shared`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    ALTER TABLE session
      ADD COLUMN shared boolean NOT NULL DEFAULT false
  `.execute(db);
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
}
