import { sql, type Kysely } from 'kysely';
import { SCHEDULE_AGENT_ID_IDX } from '../../indexes';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await db.schema.alterTable('schedule').addColumn('agent_id', 'text').execute();

  await sql`
    UPDATE schedule AS s
    SET agent_id = a.id
    FROM agent AS a
    WHERE s.tenant_id = a.tenant_id
      AND s.agent_name = a.name
  `.execute(db);

  await sql`ALTER TABLE schedule ALTER COLUMN agent_id SET NOT NULL`.execute(db);

  await sql`
    ALTER TABLE schedule
      ADD CONSTRAINT schedule_agent_id_fk
      FOREIGN KEY (agent_id) REFERENCES agent (id) ON DELETE CASCADE
  `.execute(db);

  await sql`
    CREATE INDEX ${sql.raw(SCHEDULE_AGENT_ID_IDX)}
      ON schedule (tenant_id, agent_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`DROP INDEX IF EXISTS ${sql.raw(SCHEDULE_AGENT_ID_IDX)}`.execute(db);
  await sql`ALTER TABLE schedule DROP CONSTRAINT IF EXISTS schedule_agent_id_fk`.execute(db);
  await db.schema.alterTable('schedule').dropColumn('agent_id').execute();
}
