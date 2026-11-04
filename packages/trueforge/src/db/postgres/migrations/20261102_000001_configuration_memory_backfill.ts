import { sql, type Kysely } from 'kysely';

/** Add the memory switch, off, to configuration rows written before it existed. */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`
    UPDATE configuration
    SET manifest = manifest || jsonb_build_object('memory', jsonb_build_object('enabled', false))
    WHERE manifest->'memory' IS NULL
  `.execute(db);
}

export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  await sql`UPDATE configuration SET manifest = manifest - 'memory'`.execute(db);
}
