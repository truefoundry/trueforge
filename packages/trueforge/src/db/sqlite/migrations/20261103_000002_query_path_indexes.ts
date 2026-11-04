import { sql, type Kysely } from 'kysely';
import {
  OAUTH_PENDING_AUTHORIZATION_SERVER_ID_IDX,
  SANDBOX_ENVIRONMENT_VERSION_PENDING_IDX,
  SESSION_AGENT_LIST_IDX,
} from '../../indexes';

/**
 * SQLite mirror of postgres/migrations/20261103_000002_query_path_indexes.ts.
 * A plain CREATE INDEX needs no table rebuild, so no `PRAGMA foreign_keys` toggle.
 * Kysely does not wrap SQLite migrations — keep the three indexes atomic.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE INDEX ${sql.raw(SESSION_AGENT_LIST_IDX)}
        ON session (tenant_id, agent_id, updated_at, session_id)
        WHERE agent_id IS NOT NULL
    `.execute(trx);
    await sql`
      CREATE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_VERSION_PENDING_IDX)}
        ON sandbox_environment_version (environment_id, version)
        WHERE status = 'pending'
    `.execute(trx);
    await sql`
      CREATE INDEX ${sql.raw(OAUTH_PENDING_AUTHORIZATION_SERVER_ID_IDX)}
        ON oauth_pending_authorization (oauth_server_id)
    `.execute(trx);
  });
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP INDEX IF EXISTS ${sql.raw(OAUTH_PENDING_AUTHORIZATION_SERVER_ID_IDX)}`.execute(trx);
    await sql`DROP INDEX IF EXISTS ${sql.raw(SANDBOX_ENVIRONMENT_VERSION_PENDING_IDX)}`.execute(trx);
    await sql`DROP INDEX IF EXISTS ${sql.raw(SESSION_AGENT_LIST_IDX)}`.execute(trx);
  });
}
