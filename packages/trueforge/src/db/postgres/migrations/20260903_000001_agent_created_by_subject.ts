import { sql, type Kysely } from 'kysely';
import { AGENT_CREATED_BY_SUBJECT_ID_IDX } from '../../indexes';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`SET LOCAL lock_timeout = '5s'`.execute(trx);
    // existing rows have no recoverable creator
    await sql`
      ALTER TABLE agent
        ADD COLUMN created_by_subject jsonb NOT NULL
          DEFAULT '{"subject_id":"trueforge-default","subject_type":"user","subject_display_name":"trueforge-default"}'::jsonb
    `.execute(trx);
    await sql`
      ALTER TABLE agent
        ALTER COLUMN created_by_subject DROP DEFAULT
    `.execute(trx);
    await sql`
      CREATE INDEX ${sql.raw(AGENT_CREATED_BY_SUBJECT_ID_IDX)}
        ON agent (tenant_id, (created_by_subject->>'subject_id'))
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`SET LOCAL lock_timeout = '5s'`.execute(trx);
    await sql`DROP INDEX IF EXISTS ${sql.raw(AGENT_CREATED_BY_SUBJECT_ID_IDX)}`.execute(trx);
    await sql`ALTER TABLE agent DROP COLUMN IF EXISTS created_by_subject`.execute(trx);
  });
}
