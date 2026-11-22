import { sql, type Kysely } from 'kysely';

/**
 * Move `metadata["is_create_agent"]` to `metadata["tfg.is_create_agent"]`.
 * Existing builder chats keep the same string value. `updated_at` stays put so chat history order does not change.
 * Rows that already have the new key are left alone.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE session
    SET metadata = (metadata - 'is_create_agent')
      || jsonb_build_object('tfg.is_create_agent', metadata->>'is_create_agent')
    WHERE jsonb_exists(metadata, 'is_create_agent')
      AND NOT jsonb_exists(metadata, 'tfg.is_create_agent')
  `.execute(db);
}

/** Move the key back. New-code rows are included, because they are not distinguishable from rewritten ones. */
export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE session
    SET metadata = (metadata - 'tfg.is_create_agent')
      || jsonb_build_object('is_create_agent', metadata->>'tfg.is_create_agent')
    WHERE jsonb_exists(metadata, 'tfg.is_create_agent')
      AND NOT jsonb_exists(metadata, 'is_create_agent')
  `.execute(db);
}
