import { sql, type Kysely } from 'kysely';

/** Explicit per-subject read grants on a session; removed with the session. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema
    .createTable('access_control')
    .addColumn('tenant_id', 'text', col => col.notNull())
    .addColumn('session_id', 'text', col => col.notNull())
    .addColumn('subject_type', 'text', col => col.notNull())
    .addColumn('subject_id', 'text', col => col.notNull())
    .addColumn('granted_by_subject', 'jsonb', col => col.notNull())
    .addColumn('created_at', 'timestamptz', col => col.notNull())
    .addPrimaryKeyConstraint('access_control_pkey', ['tenant_id', 'session_id', 'subject_type', 'subject_id'])
    .addForeignKeyConstraint('access_control_session_fkey', ['session_id'], 'session', ['session_id'], fk =>
      fk.onDelete('cascade'),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await db.schema.dropTable('access_control').ifExists().execute();
}
