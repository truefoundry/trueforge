import { sql, type Kysely } from 'kysely';

/**
 * SQLite mirror of postgres/migrations/20261022_000001_drop_session_last_turn_id.ts.
 * The column has no index or constraint, so DROP COLUMN needs no table rebuild.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE session DROP COLUMN last_turn_id`.execute(trx);
  });
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE session ADD COLUMN last_turn_id TEXT`.execute(trx);
    await sql`
      UPDATE session
      SET last_turn_id = json_extract(last_turn_details, '$.id')
      WHERE last_turn_details IS NOT NULL
    `.execute(trx);
  });
}
