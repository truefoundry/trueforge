import { sql, type Kysely } from 'kysely';
import {
  AGENT_CREATED_BY_SUBJECT_ID_IDX,
  AGENT_EXTERNAL_ID_UQ,
  SCHEDULE_CREATED_BY_SUBJECT_ID_IDX,
  SCHEDULE_RUN_CREATED_BY_SUBJECT_ID_IDX,
  SESSION_CREATED_BY_SUBJECT_ID_IDX,
  SESSION_EXTERNAL_ID_UQ,
} from '../../indexes';

/**
 * Add `created_by_subject` on agent, session, schedule, and schedule_run.
 * STRICT rebuilds (cannot ADD NOT NULL with expression default / DROP DEFAULT).
 * Backfills session/schedule/schedule_run from created_by/triggered_by;
 * agent backfills best-effort from its first created session (fallback: trueforge-default).
 * Agent has no metadata (dropped in 20260903_000001). FKs off for agent/schedule swaps.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
      await sql`
        CREATE TABLE session_new (
          tenant_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          created_by_subject BLOB NOT NULL,
          agent_id TEXT,
          agent_name TEXT,
          agent_spec BLOB,
          title TEXT,
          last_turn_id TEXT,
          external_id TEXT,
          custom BLOB,
          metadata BLOB NOT NULL DEFAULT (jsonb('{}')),
          metrics BLOB NOT NULL DEFAULT (jsonb('{"total_cost_in_usd":0,"total_duration_ms":0,"total_turns":0}')),
          last_activity_timestamp_ms INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (session_id),
          CHECK (
            (agent_id IS NOT NULL AND agent_spec IS NULL)
            OR (agent_id IS NULL AND agent_spec IS NOT NULL)
          )
        ) STRICT
      `.execute(trx);
      await sql`
        INSERT INTO session_new (
          tenant_id,
          session_id,
          created_by_subject,
          agent_id,
          agent_name,
          agent_spec,
          title,
          last_turn_id,
          external_id,
          custom,
          metadata,
          metrics,
          last_activity_timestamp_ms,
          created_at,
          updated_at
        )
        SELECT
          tenant_id,
          session_id,
          jsonb(json_object(
            'subject_id', CASE WHEN created_by = '' THEN 'trueforge-default' ELSE created_by END,
            'subject_type', 'user',
            'subject_display_name', CASE WHEN created_by = '' THEN 'trueforge-default' ELSE created_by END
          )),
          agent_id,
          agent_name,
          agent_spec,
          title,
          last_turn_id,
          external_id,
          custom,
          metadata,
          metrics,
          last_activity_timestamp_ms,
          created_at,
          updated_at
        FROM session
      `.execute(trx);
      await sql`DROP TABLE session`.execute(trx);
      await sql`ALTER TABLE session_new RENAME TO session`.execute(trx);
      await sql`
        CREATE INDEX session_list_idx
          ON session (tenant_id, created_at, session_id)
      `.execute(trx);
      await sql`
        CREATE INDEX session_agent_id_idx
          ON session (tenant_id, agent_id)
          WHERE agent_id IS NOT NULL
      `.execute(trx);
      await sql`
        CREATE INDEX session_list_updated_at_idx
          ON session (tenant_id, updated_at, session_id)
      `.execute(trx);
      await sql`
        CREATE INDEX session_agent_created_at_idx
          ON session (tenant_id, agent_id, created_at)
          WHERE agent_id IS NOT NULL
      `.execute(trx);
      await sql`
        CREATE UNIQUE INDEX ${sql.raw(SESSION_EXTERNAL_ID_UQ)}
          ON session (tenant_id, external_id)
          WHERE external_id IS NOT NULL
      `.execute(trx);
      await sql`
        CREATE INDEX ${sql.raw(SESSION_CREATED_BY_SUBJECT_ID_IDX)}
          ON session (tenant_id, json_extract(created_by_subject, '$.subject_id'))
      `.execute(trx);

      await sql`
        CREATE TABLE agent_new (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          external_id TEXT,
          created_by_subject BLOB NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (id),
          UNIQUE (tenant_id, name)
        ) STRICT
      `.execute(trx);
      await sql`
        INSERT INTO agent_new (
          id, tenant_id, name, manifest, external_id, created_by_subject, created_at, updated_at
        )
        SELECT
          a.id,
          a.tenant_id,
          a.name,
          a.manifest,
          a.external_id,
          COALESCE(
            (
              SELECT s.created_by_subject
              FROM session AS s
              WHERE s.tenant_id = a.tenant_id
                AND (s.agent_id = a.id OR (s.agent_id IS NULL AND s.agent_name = a.name))
              ORDER BY s.created_at ASC
              LIMIT 1
            ),
            jsonb('{"subject_id":"trueforge-default","subject_type":"user","subject_display_name":"trueforge-default"}')
          ),
          a.created_at,
          a.updated_at
        FROM agent AS a
      `.execute(trx);
      await sql`DROP TABLE agent`.execute(trx);
      await sql`ALTER TABLE agent_new RENAME TO agent`.execute(trx);
      await sql`
        CREATE UNIQUE INDEX ${sql.raw(AGENT_EXTERNAL_ID_UQ)}
          ON agent (tenant_id, external_id)
          WHERE external_id IS NOT NULL
      `.execute(trx);
      await sql`
        CREATE INDEX ${sql.raw(AGENT_CREATED_BY_SUBJECT_ID_IDX)}
          ON agent (tenant_id, json_extract(created_by_subject, '$.subject_id'))
      `.execute(trx);

      await sql`
        CREATE TABLE schedule_new (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          status TEXT NOT NULL CHECK (length(status) <= 16),
          created_by_subject BLOB NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (id),
          FOREIGN KEY (tenant_id, agent_name) REFERENCES agent (tenant_id, name) ON DELETE CASCADE
        ) STRICT
      `.execute(trx);
      await sql`
        INSERT INTO schedule_new (
          id, tenant_id, agent_name, name, manifest, status, created_by_subject, created_at, updated_at
        )
        SELECT
          id,
          tenant_id,
          agent_name,
          name,
          manifest,
          status,
          jsonb(json_object(
            'subject_id', CASE WHEN created_by = '' THEN 'trueforge-default' ELSE created_by END,
            'subject_type', 'user',
            'subject_display_name', CASE WHEN created_by = '' THEN 'trueforge-default' ELSE created_by END
          )),
          created_at,
          updated_at
        FROM schedule
      `.execute(trx);

      await sql`
        CREATE TABLE schedule_run_new (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          schedule_id TEXT NOT NULL REFERENCES schedule_new (id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          scheduled_for TEXT NOT NULL,
          status TEXT NOT NULL CHECK (length(status) <= 16),
          created_by_subject BLOB NOT NULL,
          triggered_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (id)
        ) STRICT
      `.execute(trx);
      await sql`
        INSERT INTO schedule_run_new (
          id,
          tenant_id,
          schedule_id,
          name,
          scheduled_for,
          status,
          created_by_subject,
          triggered_at,
          created_at,
          updated_at
        )
        SELECT
          id,
          tenant_id,
          schedule_id,
          name,
          scheduled_for,
          status,
          jsonb(json_object(
            'subject_id', CASE WHEN triggered_by = '' THEN 'trueforge-default' ELSE triggered_by END,
            'subject_type', 'user',
            'subject_display_name', CASE WHEN triggered_by = '' THEN 'trueforge-default' ELSE triggered_by END
          )),
          triggered_at,
          created_at,
          updated_at
        FROM schedule_run
      `.execute(trx);

      await sql`DROP TABLE schedule_run`.execute(trx);
      await sql`DROP TABLE schedule`.execute(trx);
      await sql`ALTER TABLE schedule_new RENAME TO schedule`.execute(trx);
      await sql`ALTER TABLE schedule_run_new RENAME TO schedule_run`.execute(trx);

      await sql`
        CREATE INDEX schedule_agent_idx
          ON schedule (tenant_id, agent_name)
      `.execute(trx);
      await sql`
        CREATE UNIQUE INDEX schedule_name_uq
          ON schedule (tenant_id, agent_name, name)
      `.execute(trx);
      await sql`
        CREATE INDEX ${sql.raw(SCHEDULE_CREATED_BY_SUBJECT_ID_IDX)}
          ON schedule (tenant_id, json_extract(created_by_subject, '$.subject_id'))
      `.execute(trx);
      await sql`
        CREATE UNIQUE INDEX schedule_run_name_idx
          ON schedule_run (tenant_id, schedule_id, name)
      `.execute(trx);
      await sql`
        CREATE INDEX schedule_run_scheduled_for_idx
          ON schedule_run (scheduled_for)
          WHERE status = 'scheduled'
      `.execute(trx);
      await sql`
        CREATE UNIQUE INDEX schedule_run_pending_uq
          ON schedule_run (schedule_id)
          WHERE status = 'scheduled'
      `.execute(trx);
      await sql`
        CREATE INDEX schedule_run_list_idx
          ON schedule_run (schedule_id, scheduled_for DESC)
      `.execute(trx);
      await sql`
        CREATE INDEX ${sql.raw(SCHEDULE_RUN_CREATED_BY_SUBJECT_ID_IDX)}
          ON schedule_run (tenant_id, json_extract(created_by_subject, '$.subject_id'))
      `.execute(trx);
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
      await sql`
        CREATE TABLE schedule_old (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          status TEXT NOT NULL CHECK (length(status) <= 16),
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (id),
          FOREIGN KEY (tenant_id, agent_name) REFERENCES agent (tenant_id, name) ON DELETE CASCADE
        ) STRICT
      `.execute(trx);
      await sql`
        INSERT INTO schedule_old (
          id, tenant_id, agent_name, name, manifest, status, created_by, created_at, updated_at
        )
        SELECT
          id,
          tenant_id,
          agent_name,
          name,
          manifest,
          status,
          COALESCE(json_extract(created_by_subject, '$.subject_id'), ''),
          created_at,
          updated_at
        FROM schedule
      `.execute(trx);

      await sql`
        CREATE TABLE schedule_run_old (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          schedule_id TEXT NOT NULL REFERENCES schedule_old (id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          scheduled_for TEXT NOT NULL,
          status TEXT NOT NULL CHECK (length(status) <= 16),
          triggered_by TEXT NOT NULL,
          triggered_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (id)
        ) STRICT
      `.execute(trx);
      await sql`
        INSERT INTO schedule_run_old (
          id,
          tenant_id,
          schedule_id,
          name,
          scheduled_for,
          status,
          triggered_by,
          triggered_at,
          created_at,
          updated_at
        )
        SELECT
          id,
          tenant_id,
          schedule_id,
          name,
          scheduled_for,
          status,
          COALESCE(json_extract(created_by_subject, '$.subject_id'), ''),
          triggered_at,
          created_at,
          updated_at
        FROM schedule_run
      `.execute(trx);

      await sql`DROP TABLE schedule_run`.execute(trx);
      await sql`DROP TABLE schedule`.execute(trx);
      await sql`ALTER TABLE schedule_old RENAME TO schedule`.execute(trx);
      await sql`ALTER TABLE schedule_run_old RENAME TO schedule_run`.execute(trx);
      await sql`
        CREATE INDEX schedule_agent_idx ON schedule (tenant_id, agent_name)
      `.execute(trx);
      await sql`
        CREATE UNIQUE INDEX schedule_name_uq ON schedule (tenant_id, agent_name, name)
      `.execute(trx);
      await sql`
        CREATE UNIQUE INDEX schedule_run_name_idx ON schedule_run (tenant_id, schedule_id, name)
      `.execute(trx);
      await sql`
        CREATE INDEX schedule_run_scheduled_for_idx
          ON schedule_run (scheduled_for) WHERE status = 'scheduled'
      `.execute(trx);
      await sql`
        CREATE UNIQUE INDEX schedule_run_pending_uq
          ON schedule_run (schedule_id) WHERE status = 'scheduled'
      `.execute(trx);
      await sql`
        CREATE INDEX schedule_run_list_idx ON schedule_run (schedule_id, scheduled_for DESC)
      `.execute(trx);

      await sql`
        CREATE TABLE agent_old (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          external_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (id),
          UNIQUE (tenant_id, name)
        ) STRICT
      `.execute(trx);
      await sql`
        INSERT INTO agent_old (id, tenant_id, name, manifest, external_id, created_at, updated_at)
        SELECT id, tenant_id, name, manifest, external_id, created_at, updated_at
        FROM agent
      `.execute(trx);
      await sql`DROP TABLE agent`.execute(trx);
      await sql`ALTER TABLE agent_old RENAME TO agent`.execute(trx);
      await sql`
        CREATE UNIQUE INDEX ${sql.raw(AGENT_EXTERNAL_ID_UQ)}
          ON agent (tenant_id, external_id) WHERE external_id IS NOT NULL
      `.execute(trx);

      await sql`
        CREATE TABLE session_old (
          tenant_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          created_by TEXT NOT NULL DEFAULT '',
          agent_id TEXT,
          agent_name TEXT,
          agent_spec BLOB,
          title TEXT,
          last_turn_id TEXT,
          external_id TEXT,
          custom BLOB,
          metadata BLOB NOT NULL DEFAULT (jsonb('{}')),
          metrics BLOB NOT NULL DEFAULT (jsonb('{"total_cost_in_usd":0,"total_duration_ms":0,"total_turns":0}')),
          last_activity_timestamp_ms INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (session_id),
          CHECK (
            (agent_id IS NOT NULL AND agent_spec IS NULL)
            OR (agent_id IS NULL AND agent_spec IS NOT NULL)
          )
        ) STRICT
      `.execute(trx);
      await sql`
        INSERT INTO session_old (
          tenant_id,
          session_id,
          created_by,
          agent_id,
          agent_name,
          agent_spec,
          title,
          last_turn_id,
          external_id,
          custom,
          metadata,
          metrics,
          last_activity_timestamp_ms,
          created_at,
          updated_at
        )
        SELECT
          tenant_id,
          session_id,
          COALESCE(json_extract(created_by_subject, '$.subject_id'), ''),
          agent_id,
          agent_name,
          agent_spec,
          title,
          last_turn_id,
          external_id,
          custom,
          metadata,
          metrics,
          last_activity_timestamp_ms,
          created_at,
          updated_at
        FROM session
      `.execute(trx);
      await sql`DROP TABLE session`.execute(trx);
      await sql`ALTER TABLE session_old RENAME TO session`.execute(trx);
      await sql`
        CREATE INDEX session_list_idx ON session (tenant_id, created_at, session_id)
      `.execute(trx);
      await sql`
        CREATE INDEX session_agent_id_idx
          ON session (tenant_id, agent_id) WHERE agent_id IS NOT NULL
      `.execute(trx);
      await sql`
        CREATE INDEX session_list_updated_at_idx ON session (tenant_id, updated_at, session_id)
      `.execute(trx);
      await sql`
        CREATE INDEX session_agent_created_at_idx
          ON session (tenant_id, agent_id, created_at) WHERE agent_id IS NOT NULL
      `.execute(trx);
      await sql`
        CREATE UNIQUE INDEX ${sql.raw(SESSION_EXTERNAL_ID_UQ)}
          ON session (tenant_id, external_id) WHERE external_id IS NOT NULL
      `.execute(trx);
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}
