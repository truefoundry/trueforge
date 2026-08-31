import { type Kysely, sql } from 'kysely';

import type { Database } from './types';

export const TRUEFORGE_SCHEMA = 'trueforge';

const TABLES_TO_MOVE = [
  'kysely_migration',
  'kysely_migration_lock',
  'session',
  'turn',
  'turn_thread',
  'session_event',
  'thread_context_log',
  'thread_capability_state',
  'model_provider',
  'skill',
  'sandbox_provider',
  'agent',
  'schedule',
  'schedule_run',
  'mcp_server',
  'oauth_token',
  'oauth_pending_authorization',
] as const;

export async function ensureTrueforgeSchema(db: Kysely<Database>): Promise<void> {
  await db.connection().execute(async conn => {
    const { rows: schemaRows } = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM pg_namespace WHERE nspname = ${TRUEFORGE_SCHEMA}
      ) AS exists
    `.execute(conn);
    if (schemaRows[0]?.exists === true) {
      return;
    }

    const { rows: lockRows } = await sql<{ locked: boolean }>`
      SELECT pg_try_advisory_lock(hashtext('trueforge_schema_bootstrap')) AS locked
    `.execute(conn);
    if (lockRows[0]?.locked !== true) {
      throw new Error('trueforge schema bootstrap is already in progress');
    }

    try {
      await conn.transaction().execute(async txn => {
        await sql`SET LOCAL lock_timeout = '5s'`.execute(txn);
        await sql`CREATE SCHEMA IF NOT EXISTS ${sql.id(TRUEFORGE_SCHEMA)}`.execute(txn);
        for (const tableName of TABLES_TO_MOVE) {
          await sql`
            ALTER TABLE IF EXISTS ${sql.id('public', tableName)} SET SCHEMA ${sql.id(TRUEFORGE_SCHEMA)}
          `.execute(txn);
        }
      });
    } finally {
      await sql`SELECT pg_advisory_unlock(hashtext('trueforge_schema_bootstrap'))`.execute(conn);
    }
  });
}
