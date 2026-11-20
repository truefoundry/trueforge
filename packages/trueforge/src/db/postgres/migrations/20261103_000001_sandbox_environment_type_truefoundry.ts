import { sql, type Kysely } from 'kysely';
import { isTrueFoundryModeEnabled } from '../../../config';

/**
 * TrueFoundry mode stores `type: 'truefoundry'` on sandbox environment versions; older rows
 * recorded the backing provider (e.g. `daytona`) as `type`. `sandbox_provider` is left as-is.
 * No-op outside TrueFoundry mode so OSS deployments keep their provider type.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  if (!isTrueFoundryModeEnabled()) {
    return;
  }
  const result = await sql`
    UPDATE sandbox_environment_version
    SET manifest = jsonb_set(manifest, '{type}', '"truefoundry"'::jsonb)
    WHERE manifest->>'type' IS DISTINCT FROM 'truefoundry'
  `.execute(db);
  console.log(`sandbox-environment-type-truefoundry migration: updated=${String(result.numAffectedRows ?? 0n)}`);
}

/** Before this change TFY rows always had `type` equal to `sandbox_provider`. */
export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  if (!isTrueFoundryModeEnabled()) {
    return;
  }
  await sql`
    UPDATE sandbox_environment_version
    SET manifest = jsonb_set(manifest, '{type}', manifest->'sandbox_provider')
    WHERE manifest->>'type' = 'truefoundry'
      AND manifest->>'sandbox_provider' IS DISTINCT FROM 'truefoundry'
  `.execute(db);
}
