import { sql, type Kysely } from 'kysely';
import { SCHEDULE_CREATED_BY_SUBJECT_ID_IDX, SCHEDULE_RUN_CREATED_BY_SUBJECT_ID_IDX } from '../../indexes';

/**
 * Replace schedule.created_by and schedule_run.triggered_by with created_by_subject.
 * Rebuild both STRICT tables; preserve FKs and all indexes including schedule_name_uq.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
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
          id,
          tenant_id,
          agent_name,
          name,
          manifest,
          status,
          created_by_subject,
          created_at,
          updated_at
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
          r.id,
          r.tenant_id,
          r.schedule_id,
          r.name,
          r.scheduled_for,
          r.status,
          COALESCE(
            s.created_by_subject,
            jsonb(json_object(
              'subject_id', CASE WHEN r.triggered_by = '' THEN 'trueforge-default' ELSE r.triggered_by END,
              'subject_type', 'user',
              'subject_display_name', CASE WHEN r.triggered_by = '' THEN 'trueforge-default' ELSE r.triggered_by END
            ))
          ),
          r.triggered_at,
          r.created_at,
          r.updated_at
        FROM schedule_run AS r
        LEFT JOIN schedule_new AS s ON s.id = r.schedule_id
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
          id,
          tenant_id,
          agent_name,
          name,
          manifest,
          status,
          created_by,
          created_at,
          updated_at
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
        CREATE INDEX schedule_agent_idx
          ON schedule (tenant_id, agent_name)
      `.execute(trx);
      await sql`
        CREATE UNIQUE INDEX schedule_name_uq
          ON schedule (tenant_id, agent_name, name)
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
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}
