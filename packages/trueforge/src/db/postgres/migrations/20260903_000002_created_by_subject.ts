import { sql, type Kysely } from 'kysely';
import {
  AGENT_CREATED_BY_SUBJECT_ID_IDX,
  SCHEDULE_CREATED_BY_SUBJECT_ID_IDX,
  SCHEDULE_RUN_CREATED_BY_SUBJECT_ID_IDX,
  SESSION_CREATED_BY_SUBJECT_ID_IDX,
} from '../../indexes';

/**
 * Add `created_by_subject` jsonb on agent, session, schedule, and schedule_run.
 * Backfills session/schedule/schedule_run from created_by/triggered_by;
 * agent backfills best-effort from its first created session (fallback: trueforge-default).
 * Runs inside the Migrator's transaction — do not nest `db.transaction()`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';

    ALTER TABLE session
      ADD COLUMN created_by_subject jsonb;
    UPDATE session
    SET created_by_subject = jsonb_build_object(
      'subject_id', CASE WHEN created_by = '' THEN 'trueforge-default' ELSE created_by END,
      'subject_type', 'user',
      'subject_display_name', CASE WHEN created_by = '' THEN 'trueforge-default' ELSE created_by END
    );
    ALTER TABLE session
      ALTER COLUMN created_by_subject SET NOT NULL;
    ALTER TABLE session DROP COLUMN created_by;
    CREATE INDEX ${sql.raw(SESSION_CREATED_BY_SUBJECT_ID_IDX)}
      ON session (tenant_id, (created_by_subject->>'subject_id'));

    ALTER TABLE agent
      ADD COLUMN created_by_subject jsonb;
    UPDATE agent AS a
    SET created_by_subject = COALESCE(
      (
        SELECT s.created_by_subject
        FROM session AS s
        WHERE s.tenant_id = a.tenant_id
          AND (s.agent_id = a.id OR (s.agent_id IS NULL AND s.agent_name = a.name))
        ORDER BY s.created_at ASC
        LIMIT 1
      ),
      '{"subject_id":"trueforge-default","subject_type":"user","subject_display_name":"trueforge-default"}'::jsonb
    );
    ALTER TABLE agent
      ALTER COLUMN created_by_subject SET NOT NULL;
    CREATE INDEX ${sql.raw(AGENT_CREATED_BY_SUBJECT_ID_IDX)}
      ON agent (tenant_id, (created_by_subject->>'subject_id'));

    ALTER TABLE schedule
      ADD COLUMN created_by_subject jsonb;
    UPDATE schedule
    SET created_by_subject = jsonb_build_object(
      'subject_id', CASE WHEN created_by = '' THEN 'trueforge-default' ELSE created_by END,
      'subject_type', 'user',
      'subject_display_name', CASE WHEN created_by = '' THEN 'trueforge-default' ELSE created_by END
    );
    ALTER TABLE schedule
      ALTER COLUMN created_by_subject SET NOT NULL;
    ALTER TABLE schedule DROP COLUMN created_by;
    CREATE INDEX ${sql.raw(SCHEDULE_CREATED_BY_SUBJECT_ID_IDX)}
      ON schedule (tenant_id, (created_by_subject->>'subject_id'));

    ALTER TABLE schedule_run
      ADD COLUMN created_by_subject jsonb;
    UPDATE schedule_run
    SET created_by_subject = jsonb_build_object(
      'subject_id', CASE WHEN triggered_by = '' THEN 'trueforge-default' ELSE triggered_by END,
      'subject_type', 'user',
      'subject_display_name', CASE WHEN triggered_by = '' THEN 'trueforge-default' ELSE triggered_by END
    );
    ALTER TABLE schedule_run
      ALTER COLUMN created_by_subject SET NOT NULL;
    ALTER TABLE schedule_run DROP COLUMN triggered_by;
    CREATE INDEX ${sql.raw(SCHEDULE_RUN_CREATED_BY_SUBJECT_ID_IDX)}
      ON schedule_run (tenant_id, (created_by_subject->>'subject_id'));
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';

    DROP INDEX IF EXISTS ${sql.raw(SCHEDULE_RUN_CREATED_BY_SUBJECT_ID_IDX)};
    ALTER TABLE schedule_run
      ADD COLUMN triggered_by text NOT NULL DEFAULT '';
    UPDATE schedule_run
    SET triggered_by = COALESCE(created_by_subject->>'subject_id', '');
    ALTER TABLE schedule_run DROP COLUMN created_by_subject;

    DROP INDEX IF EXISTS ${sql.raw(SCHEDULE_CREATED_BY_SUBJECT_ID_IDX)};
    ALTER TABLE schedule
      ADD COLUMN created_by text NOT NULL DEFAULT '';
    UPDATE schedule
    SET created_by = COALESCE(created_by_subject->>'subject_id', '');
    ALTER TABLE schedule DROP COLUMN created_by_subject;

    DROP INDEX IF EXISTS ${sql.raw(AGENT_CREATED_BY_SUBJECT_ID_IDX)};
    ALTER TABLE agent DROP COLUMN IF EXISTS created_by_subject;

    DROP INDEX IF EXISTS ${sql.raw(SESSION_CREATED_BY_SUBJECT_ID_IDX)};
    ALTER TABLE session
      ADD COLUMN created_by text NOT NULL DEFAULT '';
    UPDATE session
    SET created_by = COALESCE(created_by_subject->>'subject_id', '');
    ALTER TABLE session DROP COLUMN created_by_subject;
  `.execute(db);
}
