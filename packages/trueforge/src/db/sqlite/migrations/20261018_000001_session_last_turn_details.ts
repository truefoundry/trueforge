import { sql, type Kysely } from 'kysely';

/**
 * SQLite mirror of postgres/migrations/20261018_000001_session_last_turn_details.ts.
 * Nullable ADD COLUMN needs no table rebuild; column add and backfill share one txn.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE session ADD COLUMN last_turn_details BLOB`.execute(trx);
    await sql`
      UPDATE session
      SET last_turn_details = jsonb(
        json_object('id', t.turn_id, 'state', json_object('status', json_extract(t.state, '$.status')))
      )
      FROM turn t
      WHERE t.session_id = session.session_id
        AND t.turn_id = session.last_turn_id
    `.execute(trx);
  });
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE session DROP COLUMN last_turn_details`.execute(trx);
  });
}
