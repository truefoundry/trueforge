import { sql, type Kysely } from 'kysely';
import { SESSION_TFG_SOURCE_LIST_IDX } from '../../indexes';

/**
 * A caller's sessions in keyset order, so their newest-first listing needs no sort with or without
 * a `tfg.source` filter; the filter is checked on index entries without visiting the table.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    CREATE INDEX ${sql.raw(SESSION_TFG_SOURCE_LIST_IDX)}
      ON session (
        tenant_id,
        (created_by_subject->>'subject_id'),
        updated_at,
        session_id,
        (metadata->>'tfg.source')
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(SESSION_TFG_SOURCE_LIST_IDX)}`.execute(db);
}
