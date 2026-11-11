import { sql, type Kysely } from 'kysely';
import { SESSION_EVENT_FEATURE_TYPE_IDX } from '../../indexes';

/**
 * Lets analytics read a session's feature-signal events without parsing every event payload.
 * `IF NOT EXISTS` lets large deployments pre-create it `CONCURRENTLY`; this build blocks event inserts.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS ${sql.raw(SESSION_EVENT_FEATURE_TYPE_IDX)}
      ON session_event (session_id)
      WHERE event->>'type' IN ('sandbox.created', 'model.message', 'thread.created')
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(SESSION_EVENT_FEATURE_TYPE_IDX)}`.execute(db);
}
