import { sql, type Kysely } from 'kysely';

/**
 * Persist turn ownership on the turn row. Backfills from the legacy peered
 * turn_id grammar `{ulid}.{executorId}`; remaining rows get standalone `local`.
 * Mirrors db/postgres/migrations/20260918_000001_turn_active_executor_id.ts.
 * Kysely does not wrap SQLite migrations — keep schema + backfill atomic.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      ALTER TABLE turn
        ADD COLUMN active_executor_id TEXT NOT NULL DEFAULT ''
    `.execute(trx);

    await sql`
      UPDATE turn
      SET active_executor_id = substr(turn_id, instr(turn_id, '.') + 1)
      WHERE turn_id GLOB '*.*'
        AND turn_id NOT GLOB '*.*.*'
        AND turn_id NOT GLOB '.*'
        AND turn_id NOT GLOB '*.'
    `.execute(trx);

    await sql`
      UPDATE turn
      SET active_executor_id = 'local'
      WHERE active_executor_id = ''
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE turn DROP COLUMN active_executor_id`.execute(trx);
  });
}
