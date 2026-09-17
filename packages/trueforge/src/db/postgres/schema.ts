import { type Kysely, sql } from 'kysely';

import configuration, { DEFAULT_TRUEFORGE_SCHEMA } from '../../config';
import type { Database } from './types';

export function getTrueforgeSchema(): string {
  if (configuration.STANDALONE) {
    return DEFAULT_TRUEFORGE_SCHEMA;
  }
  return configuration.TRUEFORGE_SCHEMA;
}

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
  const schema = getTrueforgeSchema();
  await db.transaction().execute(async txn => {
    await sql`SET LOCAL lock_timeout = '5s'`.execute(txn);
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`trueforge_schema_bootstrap:${schema}`}))`.execute(txn);

    const result = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_namespace
        WHERE nspname = ${schema}
      ) AS exists
    `.execute(txn);
    if (result.rows[0]?.exists === true) {
      return;
    }

    await sql`CREATE SCHEMA IF NOT EXISTS ${sql.id(schema)}`.execute(txn);
    if (
      !configuration.STANDALONE &&
      configuration.AUTOMATICALLY_MOVE_TRUEFORGE_TABLES_FROM_PUBLIC_TO_TRUEFORGE_SCHEMA
    ) {
      for (const tableName of TABLES_TO_MOVE) {
        await sql`
          ALTER TABLE IF EXISTS ${sql.id('public', tableName)} SET SCHEMA ${sql.id(schema)}
        `.execute(txn);
      }
    }
  });
}
