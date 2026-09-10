import { sql, type Kysely } from 'kysely';

/**
 * Agent registry metadata jsonb column.
 * Default `{}` for existing rows.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    ALTER TABLE agent
      ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE agent DROP COLUMN IF EXISTS metadata`.execute(db);
}
