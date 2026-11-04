import { sql, type Kysely } from 'kysely';

/** SQLite mirror of postgres/20261104_000001_sandbox_environment_metadata.ts. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE sandbox_environment ADD COLUMN metadata BLOB`.execute(trx);
    await sql`UPDATE sandbox_environment SET metadata = jsonb('{}')`.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE sandbox_environment DROP COLUMN metadata`.execute(trx);
  });
}
