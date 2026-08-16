import { type Kysely, sql } from 'kysely';

/**
 * listSessions orders by `updated_at` (session_id tie-break). Keep
 * `session_list_idx` on `created_at` for start/end timestamp filters.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE INDEX session_list_updated_at_idx
        ON session (tenant_id, updated_at, session_id)
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP INDEX session_list_updated_at_idx`.execute(trx);
  });
}
