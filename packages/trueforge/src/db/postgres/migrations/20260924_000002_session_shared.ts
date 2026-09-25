import { sql, type Kysely } from 'kysely';

/** Tenant-visible share flag. Existing sessions stay private. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';
    ALTER TABLE session
      ADD COLUMN shared boolean NOT NULL DEFAULT false;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    SET LOCAL lock_timeout = '5s';
    ALTER TABLE session DROP COLUMN IF EXISTS shared;
  `.execute(db);
}
