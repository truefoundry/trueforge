import { sql, type Kysely } from 'kysely';
import { SCHEDULE_AGENT_ID_IDX, SCHEDULE_CREATED_BY_SUBJECT_ID_IDX } from '../../indexes';

/**
 * Add NOT NULL `agent_id` on schedule — mirrors
 * db/postgres/migrations/20260904_000001_schedule_agent_id.ts.
 * Drops the `(tenant_id, agent_name)` FK; binding is `agent(id)` only.
 *
 * SQLite STRICT cannot ADD a NOT NULL column without a DEFAULT, so rebuild
 * `schedule` (FKs off so `schedule_run` rows survive the drop/rename).
 * better-sqlite3 prepares one statement per call — keep statements separate.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);
  try {
    await db.transaction().execute(async trx => {
      await sql`
        CREATE TABLE schedule_new (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          name TEXT NOT NULL,
          manifest BLOB NOT NULL,
          status TEXT NOT NULL CHECK (length(status) <= 16),
          created_by_subject BLOB NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (id),
          FOREIGN KEY (agent_id) REFERENCES agent (id) ON DELETE CASCADE
        ) STRICT
      `.execute(trx);

      await sql`
        INSERT INTO schedule_new (
          id,
          tenant_id,
          agent_id,
          agent_name,
          name,
          manifest,
          status,
          created_by_subject,
          created_at,
          updated_at
        )
        SELECT
          s.id,
          s.tenant_id,
          a.id,
          s.agent_name,
          s.name,
          s.manifest,
          s.status,
          s.created_by_subject,
          s.created_at,
          s.updated_at
        FROM schedule AS s
        INNER JOIN agent AS a
          ON a.tenant_id = s.tenant_id
         AND a.name = s.agent_name
      `.execute(trx);

      await sql`DROP TABLE schedule`.execute(trx);
      await sql`ALTER TABLE schedule_new RENAME TO schedule`.execute(trx);

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
        CREATE INDEX ${sql.raw(SCHEDULE_AGENT_ID_IDX)}
          ON schedule (tenant_id, agent_id)
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
          created_by_subject BLOB NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (id),
          FOREIGN KEY (tenant_id, agent_name) REFERENCES agent (tenant_id, name) ON DELETE CASCADE
        ) STRICT
      `.execute(trx);

      await sql`
        INSERT INTO schedule_old (
          id, tenant_id, agent_name, name, manifest, status, created_by_subject, created_at, updated_at
        )
        SELECT
          id, tenant_id, agent_name, name, manifest, status, created_by_subject, created_at, updated_at
        FROM schedule
      `.execute(trx);

      await sql`DROP TABLE schedule`.execute(trx);
      await sql`ALTER TABLE schedule_old RENAME TO schedule`.execute(trx);

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
    });
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}
