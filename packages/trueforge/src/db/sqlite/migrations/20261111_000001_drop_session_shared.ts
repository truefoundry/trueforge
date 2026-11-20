import { sql, type Kysely } from 'kysely';

/**
 * SQLite mirror of postgres/migrations/20261111_000001_drop_session_shared.ts.
 * The column has no index or constraint, so DROP COLUMN needs no table rebuild.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE session DROP COLUMN shared`.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      ALTER TABLE session
        ADD COLUMN shared INTEGER NOT NULL DEFAULT 0
    `.execute(trx);
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
  });
}
