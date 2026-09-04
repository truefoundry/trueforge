import { sql, type Kysely } from 'kysely';

/**
 * Drop agent.metadata — identity lives in external_id; column was never on the public Agent API.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE agent DROP COLUMN IF EXISTS metadata`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    ALTER TABLE agent
      ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb
  `.execute(db);
}
