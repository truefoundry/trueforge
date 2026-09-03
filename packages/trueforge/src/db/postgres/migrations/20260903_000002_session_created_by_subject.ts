import { sql, type Kysely } from 'kysely';
import { SESSION_CREATED_BY_SUBJECT_ID_IDX } from '../../indexes';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`SET LOCAL lock_timeout = '5s'`.execute(trx);

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
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`SET LOCAL lock_timeout = '5s'`.execute(trx);

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
  });
}
