import { sql, type Kysely } from 'kysely';

/**
 * Stream sequence lives beside the event payload so a missing stream can be rebuilt.
 * Mirrors db/postgres/migrations/20261028_000003_session_event_sequence_number.ts.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      ALTER TABLE session_event
        ADD COLUMN sequence_number INTEGER
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE session_event DROP COLUMN sequence_number`.execute(trx);
  });
}
