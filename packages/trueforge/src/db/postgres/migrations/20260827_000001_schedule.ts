import { sql, type Kysely } from 'kysely';

/**
 * Scheduled agents: `schedule` + `schedule_run`.
 *
 * - `schedule`: immutable application-generated `id` (ULID) as PK. Spec lives in
 *   Zod-validated `manifest` jsonb (same pattern as `agent`). Bound by agent
 *   name: FK `(tenant_id, agent_name)` → `agent(tenant_id, name)` ON DELETE CASCADE
 *   (agent names are unique and immutable within a tenant).
 * - `schedule_run`: one row per run, past or pending. The single pending run is a
 *   row like any other (`status = 'scheduled'`), which is what makes "next trigger
 *   time" a plain query instead of a computation.
 *
 * Three deliberate index choices:
 * - `schedule_run_scheduled_for_idx` is PARTIAL on `status = 'scheduled'`. The table is
 *   overwhelmingly terminal rows, so an unfiltered scheduled_for index would get steadily
 *   more expensive as history grows, for no benefit.
 * - `schedule_run_pending_uq` enforces AT MOST ONE pending run per schedule. This
 *   is the resume-vs-trigger race expressed as a constraint instead of code.
 * - `schedule_run_name_idx` makes a repeated trigger idempotent: one trigger time maps to
 *   exactly one row (`sched-<unixSeconds>`), so a duplicated dispatch cannot
 *   double-insert.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await db.schema
    .createTable('schedule')
    .addColumn('id', 'text', col => col.notNull())
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('agent_name', 'text', col => col.notNull())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('manifest', 'jsonb', col => col.notNull())
    .addColumn('status', 'text', col => col.notNull())
    .addColumn('created_by', 'text', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('schedule_pkey', ['id'])
    .addForeignKeyConstraint(
      'schedule_agent_name_fk',
      ['tenant_id', 'agent_name'],
      'agent',
      ['tenant_id', 'name'],
      cb => cb.onDelete('cascade'),
    )
    .execute();

  // Schedules are listed per agent (the agent detail page) far more than globally.
  await db.schema.createIndex('schedule_agent_idx').on('schedule').columns(['tenant_id', 'agent_name']).execute();

  await db.schema
    .createTable('schedule_run')
    .addColumn('id', 'text', col => col.notNull())
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('schedule_id', 'text', col => col.notNull().references('schedule.id').onDelete('cascade'))
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('scheduled_for', 'timestamptz', col => col.notNull())
    .addColumn('status', sql`varchar(16)`, col => col.notNull())
    .addColumn('triggered_by', 'text', col => col.notNull())
    .addColumn('triggered_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('schedule_run_pkey', ['id'])
    .execute();

  // A run row takes two or three small bounded updates in its life
  // (scheduled -> triggered -> terminal); leave HOT headroom for them.
  await sql`ALTER TABLE schedule_run SET (fillfactor = 85)`.execute(db);

  await db.schema
    .createIndex('schedule_run_name_idx')
    .on('schedule_run')
    .columns(['tenant_id', 'schedule_id', 'name'])
    .unique()
    .execute();

  await sql`
    CREATE INDEX schedule_run_scheduled_for_idx
      ON schedule_run (scheduled_for)
      WHERE status = 'scheduled'
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX schedule_run_pending_uq
      ON schedule_run (schedule_id)
      WHERE status = 'scheduled'
  `.execute(db);

  // Run history: newest first within one schedule.
  await sql`
    CREATE INDEX schedule_run_list_idx
      ON schedule_run (schedule_id, scheduled_for DESC)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('schedule_run').ifExists().cascade().execute();
  await db.schema.dropTable('schedule').ifExists().cascade().execute();
}
