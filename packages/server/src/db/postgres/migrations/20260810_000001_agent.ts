import { sql, type Kysely } from 'kysely';

/**
 * Configured agents (canonical DDL owner).
 *
 * Identity: immutable application-generated `id` (ULID) as PK; natural lookup
 * key is UNIQUE (tenant_id, name). Everything else lives in one Zod-validated
 * `manifest` jsonb (AgentSpec) so future fields are schema changes, not
 * migrations — same pattern as mcp_server.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .createTable('agent')
    .addColumn('id', 'text', col => col.notNull())
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('name', 'text', col => col.notNull())
    .addColumn('manifest', 'jsonb', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addColumn('updated_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('agent_pkey', ['id'])
    .execute();

  await db.schema.createIndex('agent_tenant_name_idx').on('agent').columns(['tenant_id', 'name']).unique().execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('agent').ifExists().cascade().execute();
}
