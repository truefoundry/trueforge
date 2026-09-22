import { type Kysely, sql } from 'kysely';

/** Add agent `description`; backfill existing rows from `name`. Mirrors postgres. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE agent ADD COLUMN description TEXT NOT NULL DEFAULT ''`.execute(trx);
    await sql`UPDATE agent SET description = name`.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE agent DROP COLUMN description`.execute(trx);
  });
}
