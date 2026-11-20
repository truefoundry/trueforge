import { sql, type Kysely } from 'kysely';

/**
 * SQLite mirror of postgres/migrations/20261120_000001_session_tfg_is_create_agent.ts.
 * `json_quote` keeps the value a JSON string. The text `true` is itself valid JSON and would otherwise be stored as a boolean.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE session
      SET metadata = json_remove(
        jsonb_set(
          metadata,
          '$."tfg.is_create_agent"',
          json_quote(json_extract(metadata, '$."is_create_agent"'))
        ),
        '$."is_create_agent"'
      )
      WHERE json_extract(metadata, '$."is_create_agent"') IS NOT NULL
        AND json_extract(metadata, '$."tfg.is_create_agent"') IS NULL
    `.execute(trx);
  });
}

/** Move the key back. New-code rows are included, because they are not distinguishable from rewritten ones. */
export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      UPDATE session
      SET metadata = json_remove(
        jsonb_set(
          metadata,
          '$."is_create_agent"',
          json_quote(json_extract(metadata, '$."tfg.is_create_agent"'))
        ),
        '$."tfg.is_create_agent"'
      )
      WHERE json_extract(metadata, '$."tfg.is_create_agent"') IS NOT NULL
        AND json_extract(metadata, '$."is_create_agent"') IS NULL
    `.execute(trx);
  });
}
