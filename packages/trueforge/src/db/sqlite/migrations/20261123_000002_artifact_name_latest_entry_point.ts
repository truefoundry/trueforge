import { sql, type Kysely } from 'kysely';

/** SQLite mirror of postgres/migrations/20261123_000002_artifact_name_latest_entry_point.ts. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE artifact RENAME COLUMN title TO name`.execute(trx);
    await sql`ALTER TABLE artifact ADD COLUMN latest_entry_point TEXT`.execute(trx);
    await sql`
      UPDATE artifact
      SET latest_entry_point = (
        SELECT v.entry_point
        FROM artifact_version v
        WHERE v.artifact_id = artifact.id AND v.version = artifact.latest_version
      )
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE artifact DROP COLUMN latest_entry_point`.execute(trx);
    await sql`ALTER TABLE artifact RENAME COLUMN name TO title`.execute(trx);
  });
}
