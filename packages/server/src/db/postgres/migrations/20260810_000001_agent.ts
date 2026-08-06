import { sql, type Kysely } from 'kysely';

/**
 * Agent registry + session agent binding.
 *
 * - `agent`: immutable application-generated `id` (ULID) as PK; natural lookup
 *   key is UNIQUE (tenant_id, name). Spec lives in Zod-validated `manifest` jsonb
 *   (same pattern as mcp_server).
 * - `session`: agent_id XOR agent_spec. Existing rows keep inline agent_spec with
 *   agent_id NULL.
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

  await db.schema.alterTable('session').addColumn('agent_id', 'text').execute();

  await sql`ALTER TABLE session ALTER COLUMN agent_spec DROP NOT NULL`.execute(db);

  await sql`
    ALTER TABLE session
      ADD CONSTRAINT session_agent_xor_check
      CHECK (
        (agent_id IS NOT NULL AND agent_spec IS NULL)
        OR (agent_id IS NULL AND agent_spec IS NOT NULL)
      )
  `.execute(db);

  await sql`
    CREATE INDEX session_agent_id_idx
      ON session (tenant_id, agent_id)
      WHERE agent_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS session_agent_id_idx`.execute(db);
  await sql`ALTER TABLE session DROP CONSTRAINT IF EXISTS session_agent_xor_check`.execute(db);
  await sql`
    DELETE FROM session WHERE agent_spec IS NULL
  `.execute(db);
  await sql`ALTER TABLE session ALTER COLUMN agent_spec SET NOT NULL`.execute(db);
  await db.schema.alterTable('session').dropColumn('agent_id').execute();
  await db.schema.dropTable('agent').ifExists().cascade().execute();
}
