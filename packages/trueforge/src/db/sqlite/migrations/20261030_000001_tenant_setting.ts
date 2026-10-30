import { sql, type Kysely } from 'kysely';

/**
 * Tenant-wide feature switches — mirrors Postgres `tenant_setting`.
 * Singleton per tenant: PK is `tenant_id` only.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE tenant_setting (
        tenant_id TEXT NOT NULL,
        manifest BLOB NOT NULL,
        PRIMARY KEY (tenant_id)
      ) STRICT
    `.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`DROP TABLE IF EXISTS tenant_setting`.execute(trx);
  });
}
