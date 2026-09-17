import { type Kysely, sql } from 'kysely';

import { getTrueForgePostgresSchema } from '../schema';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`CREATE SCHEMA IF NOT EXISTS ${sql.id(getTrueForgePostgresSchema())}`.execute(db);
}

// No-op: dropping the schema would take the Migrator's own bookkeeping table with it.
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`SELECT 1`.execute(db);
}
