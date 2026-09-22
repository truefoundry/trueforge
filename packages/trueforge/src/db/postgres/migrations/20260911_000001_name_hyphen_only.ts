import { sql, type Kysely } from 'kysely';
import { applyNameHyphenOnlyMigration } from '../../applyNameHyphenOnlyMigration';

/**
 * Postgres migration: rename old `.`/`_` names to hyphen-only.
 * Shared logic lives in applyNameHyphenOnlyMigration.ts. Cannot undo.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  try {
    await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
    await applyNameHyphenOnlyMigration({
      db,
      dialect: {
        bindJson: value => sql`${JSON.stringify(value)}::jsonb`,
        touchUpdatedAt: () => sql`now()`,
        readJson: column => sql.ref(column),
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed NameSchema hyphen-only migration: ${detail}`, { cause: error });
  }
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  return Promise.reject(new Error(`This migration is not reversible`));
}
