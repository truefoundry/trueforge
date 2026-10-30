import { sql, type Kysely } from 'kysely';
import { SESSION_MEMORY_INGEST_IDX } from '../../indexes';

/**
 * SQLite mirror of postgres/migrations/20261030_000002_session_memory_ingest_idx.ts.
 * The key contains a dot, so the JSON path must quote it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE INDEX ${sql.raw(SESSION_MEMORY_INGEST_IDX)}
        ON session (updated_at, session_id)
        WHERE source IS NULL AND (json_extract(metadata, '$."tfg.source"') = 'ui' OR agent_id IS NOT NULL)
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP INDEX IF EXISTS ${sql.raw(SESSION_MEMORY_INGEST_IDX)}`.execute(trx);
  });
}
