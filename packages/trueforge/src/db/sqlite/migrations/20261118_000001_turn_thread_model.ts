import { sql, type Kysely } from 'kysely';

/**
 * Record each thread's model on its checkpoint. Missing values become null.
 * A name string becomes `{ name, effort: null }`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE turn_thread
      SET checkpoint = jsonb_set(checkpoint, '$.model', jsonb('null'))
      WHERE json_type(checkpoint, '$.model') IS NULL
    `.execute(trx);
    await sql`
      UPDATE turn_thread
      SET checkpoint = jsonb_set(
        checkpoint,
        '$.model',
        json_object('name', json_extract(checkpoint, '$.model'), 'effort', NULL)
      )
      WHERE json_type(checkpoint, '$.model') = 'text'
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE turn_thread
      SET checkpoint = jsonb_remove(checkpoint, '$.model')
      WHERE json_type(checkpoint, '$.model') IS NOT NULL
    `.execute(trx);
  });
}
