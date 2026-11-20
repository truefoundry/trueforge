import { sql, type Kysely } from 'kysely';

/**
 * Configured memory provider — mirrors Postgres `memory_provider`.
 * Singleton per tenant: PK is `tenant_id` only.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE memory_provider (
        tenant_id TEXT NOT NULL,
        manifest BLOB NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id)
      ) STRICT
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP TABLE IF EXISTS memory_provider`.execute(trx);
  });
}
