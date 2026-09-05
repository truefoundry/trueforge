import { sql, type Kysely } from 'kysely';
import { SESSION_SOURCE_IDX } from '../../indexes';

/**
 * Add nullable JSONB `source` on session. Mirrors
 * db/postgres/migrations/20260904_000002_session_source.ts.
 * Nullable ADD COLUMN needs no table rebuild.
 * Kysely does not wrap SQLite migrations — keep ADD COLUMN + index atomic.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE session ADD COLUMN source BLOB`.execute(trx);
    await sql`
      CREATE INDEX ${sql.raw(SESSION_SOURCE_IDX)}
        ON session (tenant_id, json_extract(source, '$.type'), json_extract(source, '$.id'))
        WHERE source IS NOT NULL
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP INDEX IF EXISTS ${sql.raw(SESSION_SOURCE_IDX)}`.execute(trx);
    await sql`ALTER TABLE session DROP COLUMN source`.execute(trx);
  });
}
