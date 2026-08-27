import { sql, type Kysely } from 'kysely';

/**
 * Scheduled agents for SQLite — mirrors
 * db/postgres/migrations/20260827_000001_schedule.ts, including the composite
 * FK to `agent(tenant_id, name)` and both partial indexes.
 *
 * SQLite differences: `manifest` is BLOB JSONB, timestamps are ISO TEXT, tables
 * are STRICT. No parent table is rebuilt here, so no `PRAGMA foreign_keys`
 * toggle is needed — the migration owns its own transaction because Kysely's
 * Migrator does not wrap SQLite migrations.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE schedule (
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
      CREATE INDEX schedule_agent_idx
        ON schedule (tenant_id, agent_name)
    `.execute(trx);

    await sql`
      CREATE TABLE schedule_run (
        id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        schedule_id TEXT NOT NULL REFERENCES schedule (id) ON DELETE CASCADE,
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
      CREATE UNIQUE INDEX schedule_run_name_idx
        ON schedule_run (tenant_id, schedule_id, name)
    `.execute(trx);

    // Partial: the table is overwhelmingly terminal rows.
    await sql`
      CREATE INDEX schedule_run_scheduled_for_idx
        ON schedule_run (scheduled_for)
        WHERE status = 'scheduled'
    `.execute(trx);

    // At most one pending run per schedule — the resume-vs-trigger race as a constraint.
    await sql`
      CREATE UNIQUE INDEX schedule_run_pending_uq
        ON schedule_run (schedule_id)
        WHERE status = 'scheduled'
    `.execute(trx);

    // Run history: newest first within one schedule.
    await sql`
      CREATE INDEX schedule_run_list_idx
        ON schedule_run (schedule_id, scheduled_for DESC)
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP TABLE IF EXISTS schedule_run`.execute(trx);
    await sql`DROP TABLE IF EXISTS schedule`.execute(trx);
  });
}
