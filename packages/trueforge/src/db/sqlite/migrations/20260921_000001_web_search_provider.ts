import { sql, type Kysely } from 'kysely';

/**
 * Configured web-search provider — mirrors Postgres `web_search_provider`.
 * Singleton per tenant: PK is `tenant_id` only.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE web_search_provider (
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
    await sql`DROP TABLE IF EXISTS web_search_provider`.execute(trx);
  });
}
