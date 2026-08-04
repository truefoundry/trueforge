import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .createTable('mcp_server')
    .addColumn('id', 'text', c => c.notNull())
    .addColumn('tenant_id', 'text', c => c.notNull())
    .addColumn('name', 'text', c => c.notNull())
    .addColumn('manifest', 'jsonb', c => c.notNull())
    .addColumn('oauth_server', 'jsonb')
    .addColumn('oauth_client', 'jsonb')
    .addColumn('created_at', 'timestamptz', c => c.notNull())
    .addColumn('updated_at', 'timestamptz', c => c.notNull())
    .addPrimaryKeyConstraint('mcp_server_pkey', ['id'])
    .execute();

  await db.schema
    .createIndex('mcp_server_tenant_name_idx')
    .on('mcp_server')
    .columns(['tenant_id', 'name'])
    .unique()
    .execute();

  await db.schema
    .createTable('oauth_token')
    .addColumn('oauth_server_id', 'text', c => c.notNull().references('mcp_server.id').onDelete('cascade'))
    .addColumn('token', 'jsonb', c => c.notNull())
    .addColumn('updated_at', 'timestamptz', c => c.notNull())
    .addPrimaryKeyConstraint('oauth_token_pkey', ['oauth_server_id'])
    .execute();

  await db.schema
    .createTable('oauth_pending_authorization')
    .addColumn('id', 'text', c => c.notNull())
    .addColumn('oauth_server_id', 'text', c => c.notNull().references('mcp_server.id').onDelete('cascade'))
    .addColumn('auth_data', 'jsonb', c => c.notNull())
    .addColumn('created_at', 'timestamptz', c => c.notNull()) // used for TTL expiry on read
    .addPrimaryKeyConstraint('oauth_pending_authorization_pkey', ['id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('oauth_pending_authorization').ifExists().cascade().execute();
  await db.schema.dropTable('oauth_token').ifExists().cascade().execute();
  await db.schema.dropTable('mcp_server').ifExists().cascade().execute();
}
