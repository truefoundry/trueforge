import { sql, type Kysely } from 'kysely';

/**
 * Backfill the tenant `"default"` sandbox environment for existing Daytona providers.
 * New providers already create it on PUT; this covers tenants that configured a provider
 * before sandbox environments existed.
 *
 * Version lands as `pending` so the build controller can activate the snapshot.
 *
 * Also drops provider-level build status columns — snapshot readiness lives on
 * sandbox environment versions now.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await sql`
    WITH providers AS (
      SELECT tenant_id
      FROM sandbox_provider
      WHERE manifest->>'type' = 'daytona'
    ),
    missing AS (
      SELECT p.tenant_id
      FROM providers p
      WHERE NOT EXISTS (
        SELECT 1
        FROM sandbox_environment e
        WHERE e.tenant_id = p.tenant_id
          AND e.name = 'default'
          AND e.lifecycle_stage = 'active'
      )
    ),
    inserted_env AS (
      INSERT INTO sandbox_environment (
        id,
        tenant_id,
        name,
        description,
        active_version,
        lifecycle_stage,
        created_by_subject,
        created_at,
        updated_at
      )
      SELECT
        'se_default_' || m.tenant_id,
        m.tenant_id,
        'default',
        '',
        1,
        'active',
        jsonb_build_object(
          'subject_id', 'trueforge-system',
          'subject_type', 'user',
          'subject_display_name', 'TrueForge'
        ),
        NOW(),
        NOW()
      FROM missing m
      RETURNING id, tenant_id
    )
    INSERT INTO sandbox_environment_version (
      id,
      environment_id,
      version,
      manifest,
      status,
      status_reason,
      external_ref,
      internal_metadata,
      created_by_subject,
      created_at,
      updated_at
    )
    SELECT
      ie.id || '_v1',
      ie.id,
      1,
      jsonb_build_object(
        'name', 'default',
        'resources', jsonb_build_object('cpu', 1, 'memory', 1, 'disk', 3),
        'type', 'daytona',
        'sandbox_provider', 'daytona'
      ),
      'pending',
      NULL,
      'trueforge-default-' || replace(ie.tenant_id, '/', '-'),
      '{"secrets":[]}'::jsonb,
      jsonb_build_object(
        'subject_id', 'trueforge-system',
        'subject_type', 'user',
        'subject_display_name', 'TrueForge'
      ),
      NOW(),
      NOW()
    FROM inserted_env ie
  `.execute(db);

  await db.schema
    .alterTable('sandbox_provider')
    .dropColumn('build_metadata')
    .dropColumn('status_reason')
    .dropColumn('status')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);

  await db.schema
    .alterTable('sandbox_provider')
    .addColumn('status', 'text', col => col.notNull().defaultTo('ready'))
    .addColumn('status_reason', 'text')
    .addColumn('build_metadata', 'jsonb')
    .execute();

  // Remove only rows this migration inserted (id prefix).
  await sql`
    DELETE FROM sandbox_environment_version
    WHERE environment_id LIKE 'se_default_%'
  `.execute(db);
  await sql`
    DELETE FROM sandbox_environment
    WHERE id LIKE 'se_default_%'
  `.execute(db);
}
