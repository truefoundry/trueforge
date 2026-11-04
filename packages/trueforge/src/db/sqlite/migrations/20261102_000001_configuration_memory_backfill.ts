import { sql, type Kysely } from 'kysely';

/** Mirrors db/postgres/migrations/20261102_000001_configuration_memory_backfill.ts. */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE configuration
      SET manifest = jsonb_set(manifest, '$.memory', jsonb(json_object('enabled', json('false'))))
      WHERE json_type(manifest, '$.memory') IS NULL
    `.execute(trx);
  });
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`UPDATE configuration SET manifest = jsonb_remove(manifest, '$.memory')`.execute(trx);
  });
}
