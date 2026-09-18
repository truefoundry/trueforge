import { sql, type Kysely } from 'kysely';

/**
 * Persist turn ownership on the turn row. Backfills from the legacy peered
 * turn_id grammar `{ulid}.{executorId}`; remaining rows get standalone `local`.
 * Runs inside the Migrator's transaction — do not nest `db.transaction()`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';

    ALTER TABLE turn
      ADD COLUMN active_executor_id text;

    UPDATE turn
    SET active_executor_id = split_part(turn_id, '.', 2)
    WHERE turn_id ~ '^[^.]+[.][^.]+$';

    UPDATE turn
    SET active_executor_id = 'local'
    WHERE active_executor_id IS NULL;

    ALTER TABLE turn
      ALTER COLUMN active_executor_id SET NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';
    ALTER TABLE turn DROP COLUMN IF EXISTS active_executor_id;
  `.execute(db);
}
