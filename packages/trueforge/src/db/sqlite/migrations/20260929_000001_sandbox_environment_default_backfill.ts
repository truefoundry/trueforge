import { sql, type Kysely } from 'kysely';

/**
 * Backfill the tenant `"default"` sandbox environment for existing Daytona providers.
 * Mirrors postgres/20260929_000001_sandbox_environment_default_backfill.ts.
 *
 * Kysely does not wrap SQLite migrations — keep inserts + column drops in one transaction.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    const providers = await sql<{ tenant_id: string }>`
      SELECT tenant_id
      FROM sandbox_provider
      WHERE json_extract(manifest, '$.type') = 'daytona'
    `.execute(trx);

    for (const row of providers.rows) {
      const existing = await sql<{ id: string }>`
        SELECT id
        FROM sandbox_environment
        WHERE tenant_id = ${row.tenant_id}
          AND name = 'default'
          AND lifecycle_stage = 'active'
        LIMIT 1
      `.execute(trx);
      if (existing.rows.length > 0) {
        continue;
      }

      const environmentId = `se_default_${row.tenant_id}`;
      const now = new Date().toISOString();
      const subject = {
        subject_id: 'trueforge-system',
        subject_type: 'user',
        subject_display_name: 'TrueForge',
      };
      const manifest = {
        name: 'default',
        resources: { cpu: 1, memory: 1, disk: 3 },
        type: 'daytona',
        sandbox_provider: 'daytona',
      };
      const internalMetadata = { secrets: [] };
      const externalRef = `trueforge-default-${row.tenant_id.replaceAll('/', '-')}`;

      await sql`
        INSERT INTO sandbox_environment (
          id, tenant_id, name, description, active_version, lifecycle_stage,
          created_by_subject, created_at, updated_at
        ) VALUES (
          ${environmentId},
          ${row.tenant_id},
          'default',
          '',
          1,
          'active',
          jsonb(${JSON.stringify(subject)}),
          ${now},
          ${now}
        )
      `.execute(trx);

      await sql`
        INSERT INTO sandbox_environment_version (
          id, environment_id, version, manifest, status, status_reason,
          external_ref, internal_metadata, created_by_subject, created_at, updated_at
        ) VALUES (
          ${`${environmentId}_v1`},
          ${environmentId},
          1,
          jsonb(${JSON.stringify(manifest)}),
          'pending',
          NULL,
          ${externalRef},
          jsonb(${JSON.stringify(internalMetadata)}),
          jsonb(${JSON.stringify(subject)}),
          ${now},
          ${now}
        )
      `.execute(trx);
    }

    await sql`ALTER TABLE sandbox_provider DROP COLUMN build_metadata`.execute(trx);
    await sql`ALTER TABLE sandbox_provider DROP COLUMN status_reason`.execute(trx);
    await sql`ALTER TABLE sandbox_provider DROP COLUMN status`.execute(trx);
  });
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.transaction().execute(async trx => {
    await sql`ALTER TABLE sandbox_provider ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'`.execute(trx);
    await sql`ALTER TABLE sandbox_provider ADD COLUMN status_reason TEXT`.execute(trx);
    await sql`ALTER TABLE sandbox_provider ADD COLUMN build_metadata BLOB`.execute(trx);

    await sql`
      DELETE FROM sandbox_environment_version
      WHERE environment_id LIKE 'se_default_%'
    `.execute(trx);
    await sql`
      DELETE FROM sandbox_environment
      WHERE id LIKE 'se_default_%'
    `.execute(trx);
  });
}
