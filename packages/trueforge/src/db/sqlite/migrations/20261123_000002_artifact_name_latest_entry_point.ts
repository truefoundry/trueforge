import { sql, type Kysely } from 'kysely';

/** SQLite mirror of postgres/migrations/20261123_000002_artifact_name_latest_entry_point.ts. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE artifact RENAME COLUMN title TO name`.execute(trx);
    await sql`ALTER TABLE artifact ADD COLUMN latest_entry_point TEXT`.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE artifact DROP COLUMN latest_entry_point`.execute(trx);
    await sql`ALTER TABLE artifact RENAME COLUMN name TO title`.execute(trx);
  });
}
