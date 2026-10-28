import { sql, type Kysely } from 'kysely';

/**
 * Drop session.last_turn_id — the tip id now lives in `last_turn_details.id`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE session DROP COLUMN IF EXISTS last_turn_id`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`ALTER TABLE session ADD COLUMN last_turn_id text`.execute(db);
  await sql`UPDATE session SET last_turn_id = last_turn_details->>'id' WHERE last_turn_details IS NOT NULL`.execute(db);
}
