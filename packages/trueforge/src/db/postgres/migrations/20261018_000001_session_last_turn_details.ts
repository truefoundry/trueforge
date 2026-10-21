import { sql, type Kysely } from 'kysely';

/**
 * Nullable `last_turn_details` (`{ id, state: { status } }`) on session, backfilled from
 * the turn `last_turn_id` points at. Sessions whose last turn row is missing stay null.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('session').addColumn('last_turn_details', 'jsonb').execute();
  await sql`
    UPDATE session s
    SET last_turn_details = jsonb_build_object(
      'id', t.turn_id,
      'state', jsonb_build_object('status', t.state->'status')
    )
    FROM turn t
    WHERE t.session_id = s.session_id
      AND t.turn_id = s.last_turn_id
  `.execute(db);
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.alterTable('session').dropColumn('last_turn_details').execute();
}
