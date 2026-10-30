import { sql, type Kysely } from 'kysely';
import { SESSION_MEMORY_INGEST_IDX } from '../../indexes';

/**
 * The memory-ingest loop reads recently active sessions across all tenants, oldest first, so the
 * other session indexes (all led by tenant_id) cannot serve it. Partial, so scheduled and API-only
 * sessions stay out. Turn completion writes only unindexed columns, so its update stays HOT.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    CREATE INDEX ${sql.raw(SESSION_MEMORY_INGEST_IDX)}
      ON session (updated_at, session_id)
      WHERE source IS NULL AND (metadata->>'tfg.source' = 'ui' OR agent_id IS NOT NULL)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(SESSION_MEMORY_INGEST_IDX)}`.execute(db);
}
