import { sql, type Kysely } from 'kysely';
import { SESSION_TFG_SOURCE_LIST_IDX } from '../../indexes';

/**
 * Equality columns first, then the keyset sort columns, so listing a caller's sessions for one
 * `tfg.source` value (or a missing key) reads them in order without a sort.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    CREATE INDEX ${sql.raw(SESSION_TFG_SOURCE_LIST_IDX)}
      ON session (
        tenant_id,
        (created_by_subject->>'subject_id'),
        (metadata->>'tfg.source'),
        updated_at,
        session_id
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(SESSION_TFG_SOURCE_LIST_IDX)}`.execute(db);
}
