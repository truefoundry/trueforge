import { sql, type Kysely } from 'kysely';

/** Stream sequence lives beside the event payload so a missing Redis key can be rebuilt. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';
    ALTER TABLE session_event
      ADD COLUMN sequence_number integer;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';
    ALTER TABLE session_event
      DROP COLUMN IF EXISTS sequence_number;
  `.execute(db);
}
