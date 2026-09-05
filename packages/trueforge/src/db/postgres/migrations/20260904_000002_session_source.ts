import { sql, type Kysely } from 'kysely';
import { SESSION_SOURCE_IDX } from '../../indexes';

/**
 * Add nullable JSONB `source` on session (schedule provenance).
 * Expression index for list filters; no denormalized scalar filter columns.
 * Runs inside the Migrator's transaction — do not nest `db.transaction()`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';

    ALTER TABLE session
      ADD COLUMN source jsonb;
    CREATE INDEX ${sql.raw(SESSION_SOURCE_IDX)}
      ON session (tenant_id, (source->>'type'), (source->>'id'))
      WHERE source IS NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';

    DROP INDEX IF EXISTS ${sql.raw(SESSION_SOURCE_IDX)};
    ALTER TABLE session DROP COLUMN IF EXISTS source;
  `.execute(db);
}
