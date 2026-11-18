import { sql, type Kysely } from 'kysely';

/** Make the per-thread model explicit on every persisted checkpoint; rows written before it was recorded get null. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE turn_thread
      SET checkpoint = jsonb_set(checkpoint, '$.model', jsonb('null'))
      WHERE json_type(checkpoint, '$.model') IS NULL
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
