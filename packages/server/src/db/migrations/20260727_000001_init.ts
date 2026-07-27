import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SELECT 1`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SELECT 1`.execute(db);
}
