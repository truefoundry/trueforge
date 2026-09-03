import { sql, type Kysely } from 'kysely';
import {
  AGENT_CREATED_BY_SUBJECT_ID_IDX,
  SCHEDULE_CREATED_BY_SUBJECT_ID_IDX,
  SCHEDULE_RUN_CREATED_BY_SUBJECT_ID_IDX,
  SESSION_CREATED_BY_SUBJECT_ID_IDX,
} from '../../indexes';

/**
 * Add `created_by_subject` jsonb on agent, session, schedule, and schedule_run.
 * Backfills from created_by / triggered_by where those columns existed; agent has no prior creator.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`SET LOCAL lock_timeout = '5s'`.execute(trx);

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

    await sql`
      ALTER TABLE session
        ADD COLUMN created_by_subject jsonb
    `.execute(trx);
    await sql`
      UPDATE session
      SET created_by_subject = jsonb_build_object(
        'subject_id', CASE WHEN created_by = '' THEN 'trueforge-default' ELSE created_by END,
        'subject_type', 'user',
        'subject_display_name', CASE WHEN created_by = '' THEN 'trueforge-default' ELSE created_by END
      )
    `.execute(trx);
    await sql`
      ALTER TABLE session
        ALTER COLUMN created_by_subject SET NOT NULL
    `.execute(trx);
    await sql`ALTER TABLE session DROP COLUMN created_by`.execute(trx);
    await sql`
      CREATE INDEX ${sql.raw(SESSION_CREATED_BY_SUBJECT_ID_IDX)}
        ON session (tenant_id, (created_by_subject->>'subject_id'))
    `.execute(trx);

    await sql`
      ALTER TABLE schedule
        ADD COLUMN created_by_subject jsonb
    `.execute(trx);
    await sql`
      UPDATE schedule
      SET created_by_subject = jsonb_build_object(
        'subject_id', CASE WHEN created_by = '' THEN 'trueforge-default' ELSE created_by END,
        'subject_type', 'user',
        'subject_display_name', CASE WHEN created_by = '' THEN 'trueforge-default' ELSE created_by END
      )
    `.execute(trx);
    await sql`
      ALTER TABLE schedule
        ALTER COLUMN created_by_subject SET NOT NULL
    `.execute(trx);
    await sql`ALTER TABLE schedule DROP COLUMN created_by`.execute(trx);
    await sql`
      CREATE INDEX ${sql.raw(SCHEDULE_CREATED_BY_SUBJECT_ID_IDX)}
        ON schedule (tenant_id, (created_by_subject->>'subject_id'))
    `.execute(trx);

    await sql`
      ALTER TABLE schedule_run
        ADD COLUMN created_by_subject jsonb
    `.execute(trx);
    await sql`
      UPDATE schedule_run
      SET created_by_subject = jsonb_build_object(
        'subject_id', CASE WHEN triggered_by = '' THEN 'trueforge-default' ELSE triggered_by END,
        'subject_type', 'user',
        'subject_display_name', CASE WHEN triggered_by = '' THEN 'trueforge-default' ELSE triggered_by END
      )
    `.execute(trx);
    await sql`
      ALTER TABLE schedule_run
        ALTER COLUMN created_by_subject SET NOT NULL
    `.execute(trx);
    await sql`ALTER TABLE schedule_run DROP COLUMN triggered_by`.execute(trx);
    await sql`
      CREATE INDEX ${sql.raw(SCHEDULE_RUN_CREATED_BY_SUBJECT_ID_IDX)}
        ON schedule_run (tenant_id, (created_by_subject->>'subject_id'))
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`SET LOCAL lock_timeout = '5s'`.execute(trx);

    await sql`DROP INDEX IF EXISTS ${sql.raw(SCHEDULE_RUN_CREATED_BY_SUBJECT_ID_IDX)}`.execute(trx);
    await sql`
      ALTER TABLE schedule_run
        ADD COLUMN triggered_by text NOT NULL DEFAULT ''
    `.execute(trx);
    await sql`
      UPDATE schedule_run
      SET triggered_by = COALESCE(created_by_subject->>'subject_id', '')
    `.execute(trx);
    await sql`ALTER TABLE schedule_run DROP COLUMN created_by_subject`.execute(trx);

    await sql`DROP INDEX IF EXISTS ${sql.raw(SCHEDULE_CREATED_BY_SUBJECT_ID_IDX)}`.execute(trx);
    await sql`
      ALTER TABLE schedule
        ADD COLUMN created_by text NOT NULL DEFAULT ''
    `.execute(trx);
    await sql`
      UPDATE schedule
      SET created_by = COALESCE(created_by_subject->>'subject_id', '')
    `.execute(trx);
    await sql`ALTER TABLE schedule DROP COLUMN created_by_subject`.execute(trx);

    await sql`DROP INDEX IF EXISTS ${sql.raw(SESSION_CREATED_BY_SUBJECT_ID_IDX)}`.execute(trx);
    await sql`
      ALTER TABLE session
        ADD COLUMN created_by text NOT NULL DEFAULT ''
    `.execute(trx);
    await sql`
      UPDATE session
      SET created_by = COALESCE(created_by_subject->>'subject_id', '')
    `.execute(trx);
    await sql`ALTER TABLE session DROP COLUMN created_by_subject`.execute(trx);

    await sql`DROP INDEX IF EXISTS ${sql.raw(AGENT_CREATED_BY_SUBJECT_ID_IDX)}`.execute(trx);
    await sql`ALTER TABLE agent DROP COLUMN IF EXISTS created_by_subject`.execute(trx);
  });
}
