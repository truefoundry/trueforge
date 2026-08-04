import { sql, type Kysely } from 'kysely';

/** Drop tenant_id from turn-scoped tables; session_id is globally unique with cascade FKs. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  // Index includes tenant_id; drop before reshaping turn.
  await db.schema.dropIndex('turn_list_idx').execute();

  // session_id must be unique before child FKs can reference it alone.
  await db.schema.alterTable('session').dropConstraint('session_pkey').execute();
  await db.schema.alterTable('session').addPrimaryKeyConstraint('session_pkey', ['session_id']).execute();

  // turn: drop tenant_id, rekey, cascade on session delete.
  await db.schema.alterTable('turn').dropConstraint('turn_pkey').execute();
  await db.schema.alterTable('turn').dropColumn('tenant_id').execute();
  await db.schema.alterTable('turn').addPrimaryKeyConstraint('turn_pkey', ['session_id', 'turn_id']).execute();
  await db.schema
    .alterTable('turn')
    .addForeignKeyConstraint('turn_session_fkey', ['session_id'], 'session', ['session_id'])
    .onDelete('cascade')
    .execute();

  // turn_thread: drop tenant_id, rekey, cascade on session delete.
  await db.schema.alterTable('turn_thread').dropConstraint('turn_thread_pkey').execute();
  await db.schema.alterTable('turn_thread').dropColumn('tenant_id').execute();
  await db.schema
    .alterTable('turn_thread')
    .addPrimaryKeyConstraint('turn_thread_pkey', ['session_id', 'turn_id', 'thread_id'])
    .execute();
  await db.schema
    .alterTable('turn_thread')
    .addForeignKeyConstraint('turn_thread_session_fkey', ['session_id'], 'session', ['session_id'])
    .onDelete('cascade')
    .execute();

  // session_event: drop tenant_id, rekey, cascade on session delete.
  await db.schema.alterTable('session_event').dropConstraint('session_event_pkey').execute();
  await db.schema.alterTable('session_event').dropColumn('tenant_id').execute();
  await db.schema
    .alterTable('session_event')
    .addPrimaryKeyConstraint('session_event_pkey', ['session_id', 'turn_id', 'event_id'])
    .execute();
  await db.schema
    .alterTable('session_event')
    .addForeignKeyConstraint('session_event_session_fkey', ['session_id'], 'session', ['session_id'])
    .onDelete('cascade')
    .execute();

  // thread_context_log: drop tenant_id, rekey, cascade on session delete.
  await db.schema.alterTable('thread_context_log').dropConstraint('thread_context_log_pkey').execute();
  await db.schema.alterTable('thread_context_log').dropColumn('tenant_id').execute();
  await db.schema
    .alterTable('thread_context_log')
    .addPrimaryKeyConstraint('thread_context_log_pkey', ['session_id', 'thread_id', 'append_id'])
    .execute();
  await db.schema
    .alterTable('thread_context_log')
    .addForeignKeyConstraint('thread_context_log_session_fkey', ['session_id'], 'session', ['session_id'])
    .onDelete('cascade')
    .execute();

  // thread_capability_state: drop tenant_id, rekey, cascade on session delete.
  await db.schema.alterTable('thread_capability_state').dropConstraint('thread_capability_state_pkey').execute();
  await db.schema.alterTable('thread_capability_state').dropColumn('tenant_id').execute();
  await db.schema
    .alterTable('thread_capability_state')
    .addPrimaryKeyConstraint('thread_capability_state_pkey', ['session_id', 'turn_id', 'thread_id', 'key'])
    .execute();
  await db.schema
    .alterTable('thread_capability_state')
    .addForeignKeyConstraint('thread_capability_state_session_fkey', ['session_id'], 'session', ['session_id'])
    .onDelete('cascade')
    .execute();

  // Rebuild list index without tenant_id.
  await db.schema.createIndex('turn_list_idx').on('turn').columns(['session_id', 'created_at', 'turn_id']).execute();
}

/** Irreversible: the dropped tenant_id values are not recoverable. */
export function down(): Promise<void> {
  return Promise.reject(new Error('20260803_000002_session_scoped_keys is not reversible'));
}
