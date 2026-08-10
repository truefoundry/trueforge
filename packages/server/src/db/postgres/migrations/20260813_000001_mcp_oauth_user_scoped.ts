import { sql, type Kysely } from 'kysely';

/**
 * Scope MCP OAuth access/refresh tokens per harness user, and stamp `user_id` on
 * pending authorizations so the public callback can write the correct token row.
 * Drops previously shared (server-only) tokens — callers must re-authorize.
 *
 * ACCESS EXCLUSIVE before each delete blocks concurrent inserts through the
 * rest of this migration transaction.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await sql`LOCK TABLE oauth_token IN ACCESS EXCLUSIVE MODE`.execute(db);
  await sql`DELETE FROM oauth_token`.execute(db);
  await db.schema
    .alterTable('oauth_token')
    .addColumn('user_id', 'text', col => col.notNull())
    .execute();
  await sql`ALTER TABLE oauth_token DROP CONSTRAINT oauth_token_pkey`.execute(db);
  await sql`ALTER TABLE oauth_token ADD CONSTRAINT oauth_token_pkey PRIMARY KEY (oauth_server_id, user_id)`.execute(db);

  // In-flight pending rows cannot be attributed to a user; drop them.
  await sql`LOCK TABLE oauth_pending_authorization IN ACCESS EXCLUSIVE MODE`.execute(db);
  await sql`DELETE FROM oauth_pending_authorization`.execute(db);
  await db.schema
    .alterTable('oauth_pending_authorization')
    .addColumn('user_id', 'text', col => col.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await sql`LOCK TABLE oauth_pending_authorization IN ACCESS EXCLUSIVE MODE`.execute(db);
  await sql`DELETE FROM oauth_pending_authorization`.execute(db);
  await db.schema.alterTable('oauth_pending_authorization').dropColumn('user_id').execute();

  await sql`LOCK TABLE oauth_token IN ACCESS EXCLUSIVE MODE`.execute(db);
  await sql`DELETE FROM oauth_token`.execute(db);
  await sql`ALTER TABLE oauth_token DROP CONSTRAINT oauth_token_pkey`.execute(db);
  await db.schema.alterTable('oauth_token').dropColumn('user_id').execute();
  await sql`ALTER TABLE oauth_token ADD CONSTRAINT oauth_token_pkey PRIMARY KEY (oauth_server_id)`.execute(db);
}
