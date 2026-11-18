import { sql, type Kysely } from 'kysely';

/** Make the per-thread model explicit on every persisted checkpoint; rows written before it was recorded get null. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE turn_thread
    SET checkpoint = jsonb_set(checkpoint, '{model}', 'null'::jsonb, true)
    WHERE NOT checkpoint ? 'model'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE turn_thread
    SET checkpoint = checkpoint - 'model'
    WHERE checkpoint ? 'model'
  `.execute(db);
}
