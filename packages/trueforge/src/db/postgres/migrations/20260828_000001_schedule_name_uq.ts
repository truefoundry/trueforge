import { sql, type Kysely } from 'kysely';

/**
 * Names a schedule uniquely within its agent: UNIQUE (tenant_id, agent_name, name).
 *
 * `schedule.name` is a slug-shaped identifier (same `NameSchema` as agents), so it
 * behaves like an addressable key rather than a free-text label. Uniqueness is scoped
 * per agent — two agents may each own a `daily-report`, one agent may not own two.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .createIndex('schedule_name_uq')
    .on('schedule')
    .columns(['tenant_id', 'agent_name', 'name'])
    .unique()
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS schedule_name_uq`.execute(db);
}
