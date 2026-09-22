import { sql, type Kysely } from 'kysely';
import { applyNameHyphenOnlyMigration } from '../../applyNameHyphenOnlyMigration';

/**
 * SQLite migration: same as Postgres (applyNameHyphenOnlyMigration.ts).
 * Uses json(column) when reading JSON so binary blobs are not corrupted. Cannot undo.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  try {
    const now = new Date().toISOString();
    await db.transaction().execute(async trx => {
      await applyNameHyphenOnlyMigration({
        db: trx,
        dialect: {
          bindJson: value => sql`jsonb(${JSON.stringify(value)})`,
          touchUpdatedAt: () => sql`${now}`,
          readJson: column => sql`json(${sql.ref(column)})`,
        },
      });
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed NameSchema hyphen-only migration: ${detail}`, { cause: error });
  }
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  void db;
  return Promise.reject(new Error(`This migration is not reversible`));
}
