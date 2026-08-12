import { sql, type Kysely } from 'kysely';

/**
 * listSessions orders by `updated_at` (session_id tie-break). Keep
 * `session_list_idx` on `created_at` for start/end timestamp filters.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .createIndex('session_list_updated_at_idx')
    .on('session')
    .columns(['tenant_id', 'updated_at', 'session_id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropIndex('session_list_updated_at_idx').execute();
}
