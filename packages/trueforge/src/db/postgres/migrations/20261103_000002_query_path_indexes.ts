import { sql, type Kysely } from 'kysely';
import {
  OAUTH_PENDING_AUTHORIZATION_SERVER_ID_IDX,
  SANDBOX_ENVIRONMENT_VERSION_PENDING_IDX,
  SESSION_AGENT_LIST_IDX,
} from '../../indexes';

/**
 * Indexes for hot query paths that no existing index or primary key prefix covers:
 *
 * - `session_agent_list_idx`: `listSessions` filtered by `agent_id` (agent history, chat history
 *   agent filter) orders by `(updated_at, session_id)`. The existing agent indexes end in
 *   `created_at`, so Postgres had to read every session of the agent and sort before LIMIT.
 * - `sandbox_environment_version_pending_idx`: `listLatestPendingVersions` (polled by the build
 *   controller) filters `status = 'pending'` and groups by `environment_id` taking `MAX(version)`;
 *   without it every poll seq-scans the version history. Partial, so it stays tiny.
 * - `oauth_pending_authorization_oauth_server_id_idx`: the `ON DELETE CASCADE` FK to `mcp_server`
 *   and `deletePendingAuthorizationsForServer` filter on `oauth_server_id`, which had no index.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    CREATE INDEX ${sql.raw(SESSION_AGENT_LIST_IDX)}
      ON session (tenant_id, agent_id, updated_at, session_id)
      WHERE agent_id IS NOT NULL
  `.execute(db);
  await sql`
    CREATE INDEX ${sql.raw(SANDBOX_ENVIRONMENT_VERSION_PENDING_IDX)}
      ON sandbox_environment_version (environment_id, version)
      WHERE status = 'pending'
  `.execute(db);
  await sql`
    CREATE INDEX ${sql.raw(OAUTH_PENDING_AUTHORIZATION_SERVER_ID_IDX)}
      ON oauth_pending_authorization (oauth_server_id)
  `.execute(db);
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(OAUTH_PENDING_AUTHORIZATION_SERVER_ID_IDX)}`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(SANDBOX_ENVIRONMENT_VERSION_PENDING_IDX)}`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(SESSION_AGENT_LIST_IDX)}`.execute(db);
}
