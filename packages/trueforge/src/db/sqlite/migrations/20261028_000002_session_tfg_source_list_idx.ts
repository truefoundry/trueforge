import { sql, type Kysely } from 'kysely';
import { SESSION_TFG_SOURCE_LIST_IDX } from '../../indexes';

/**
 * SQLite mirror of postgres/migrations/20261028_000002_session_tfg_source_list_idx.ts.
 * The key contains a dot, so the JSON path must quote it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE INDEX ${sql.raw(SESSION_TFG_SOURCE_LIST_IDX)}
        ON session (
          tenant_id,
          json_extract(created_by_subject, '$.subject_id'),
          json_extract(metadata, '$."tfg.source"'),
          updated_at,
          session_id
        )
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP INDEX IF EXISTS ${sql.raw(SESSION_TFG_SOURCE_LIST_IDX)}`.execute(trx);
  });
}
