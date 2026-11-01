import { sql, type Kysely } from 'kysely';

/**
 * Per-environment switch — mirrors Postgres `sandbox_environment.enabled`.
 * STRICT tables have no boolean, so `enabled` is INTEGER 0/1.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE sandbox_environment ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`.execute(trx);
    await sql`ALTER TABLE sandbox_environment ADD COLUMN disabled_at TEXT`.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE sandbox_environment DROP COLUMN disabled_at`.execute(trx);
    await sql`ALTER TABLE sandbox_environment DROP COLUMN enabled`.execute(trx);
  });
}
