import { sql, type Kysely } from 'kysely';

/**
 * Persist sandbox provider identity `name` (always equal to `manifest.type` for now).
 * Rebuilds the table so `name` is NOT NULL without a leftover DEFAULT (SQLite cannot
 * drop a column default in place), with UNIQUE (tenant_id, name). Also drops the
 * temporary `status` DEFAULT from the earlier status migration.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE sandbox_provider__with_name (
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        manifest BLOB NOT NULL,
        status TEXT NOT NULL,
        status_reason TEXT,
        build_metadata BLOB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id),
        UNIQUE (tenant_id, name)
      ) STRICT
    `.execute(trx);

    await sql`
      INSERT INTO sandbox_provider__with_name (
        tenant_id, name, manifest, status, status_reason, build_metadata, created_at, updated_at
      )
      SELECT
        tenant_id,
        json_extract(json(manifest), '$.type'),
        manifest,
        status,
        status_reason,
        build_metadata,
        created_at,
        updated_at
      FROM sandbox_provider
    `.execute(trx);

    await sql`DROP TABLE sandbox_provider`.execute(trx);
    await sql`ALTER TABLE sandbox_provider__with_name RENAME TO sandbox_provider`.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`
      CREATE TABLE sandbox_provider__without_name (
        tenant_id TEXT NOT NULL,
        manifest BLOB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        status_reason TEXT,
        build_metadata BLOB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id)
      ) STRICT
    `.execute(trx);

    await sql`
      INSERT INTO sandbox_provider__without_name (
        tenant_id, manifest, status, status_reason, build_metadata, created_at, updated_at
      )
      SELECT
        tenant_id, manifest, status, status_reason, build_metadata, created_at, updated_at
      FROM sandbox_provider
    `.execute(trx);

    await sql`DROP TABLE sandbox_provider`.execute(trx);
    await sql`ALTER TABLE sandbox_provider__without_name RENAME TO sandbox_provider`.execute(trx);
  });
}
