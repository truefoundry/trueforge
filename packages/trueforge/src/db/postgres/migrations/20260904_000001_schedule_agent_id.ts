import { sql, type Kysely } from 'kysely';
import { SCHEDULE_AGENT_ID_IDX } from '../../indexes';

/**
 * Add `agent_id` on schedule (stable ULID binding). Backfills from `agent` via
 * `(tenant_id, agent_name)`, then drops the name FK in favor of `agent(id)`.
 * Index mirrors `session_agent_id_idx` for per-agent schedule lists.
 * Runs inside the Migrator's transaction — do not nest `db.transaction()`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';

    ALTER TABLE schedule
      ADD COLUMN agent_id text;
    UPDATE schedule AS s
    SET agent_id = a.id
    FROM agent AS a
    WHERE s.tenant_id = a.tenant_id
      AND s.agent_name = a.name;
    ALTER TABLE schedule
      ALTER COLUMN agent_id SET NOT NULL;
    ALTER TABLE schedule
      DROP CONSTRAINT schedule_agent_name_fk;
    ALTER TABLE schedule
      ADD CONSTRAINT schedule_agent_id_fk
      FOREIGN KEY (agent_id) REFERENCES agent (id) ON DELETE CASCADE;
    CREATE INDEX ${sql.raw(SCHEDULE_AGENT_ID_IDX)}
      ON schedule (tenant_id, agent_id);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';

    DROP INDEX IF EXISTS ${sql.raw(SCHEDULE_AGENT_ID_IDX)};
    ALTER TABLE schedule
      DROP CONSTRAINT IF EXISTS schedule_agent_id_fk;
    ALTER TABLE schedule
      ADD CONSTRAINT schedule_agent_name_fk
      FOREIGN KEY (tenant_id, agent_name) REFERENCES agent (tenant_id, name) ON DELETE CASCADE;
    ALTER TABLE schedule
      DROP COLUMN agent_id;
  `.execute(db);
}
