import { sql, type Kysely } from 'kysely';

/**
 * Record each thread's model on its checkpoint. Missing values become null.
 * A name string becomes `{ name, effort: null }`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE turn_thread
    SET checkpoint = jsonb_set(checkpoint, '{model}', 'null'::jsonb, true)
    WHERE NOT checkpoint ? 'model'
  `.execute(db);
  await sql`
    UPDATE turn_thread
    SET checkpoint = jsonb_set(
      checkpoint,
      '{model}',
      jsonb_build_object('name', checkpoint->>'model', 'effort', null)
    )
    WHERE jsonb_typeof(checkpoint->'model') = 'string'
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
