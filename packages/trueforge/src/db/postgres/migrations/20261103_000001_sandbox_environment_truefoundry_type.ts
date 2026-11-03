import { sql, type Kysely } from 'kysely';
import configuration, { isTrueFoundryModeEnabled } from '../../../config';

/**
 * TrueFoundry mode labels sandbox environment versions `type: truefoundry`; earlier writes
 * stored the backend (`daytona`) in both `type` and `sandbox_provider`. Relabel `type` only;
 * `sandbox_provider` keeps the actual backend. No-op outside TrueFoundry mode.
 */
export async function up<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  if (!isTrueFoundryModeEnabled(configuration)) {
    return;
  }
  await sql`
    UPDATE sandbox_environment_version
    SET manifest = jsonb_set(manifest, '{type}', '"truefoundry"'::jsonb)
    WHERE manifest->>'type' IS DISTINCT FROM 'truefoundry'
  `.execute(db);
}

/** Restore the pre-split shape where `type` mirrored `sandbox_provider`. */
export async function down<TDatabase>(db: Kysely<TDatabase>): Promise<void> {
  await sql`SET LOCAL lock_timeout = '5s'`.execute(db);
  if (!isTrueFoundryModeEnabled(configuration)) {
    return;
  }
  await sql`
    UPDATE sandbox_environment_version
    SET manifest = jsonb_set(manifest, '{type}', manifest->'sandbox_provider')
    WHERE manifest->>'type' = 'truefoundry'
      AND manifest ? 'sandbox_provider'
      AND manifest->>'sandbox_provider' <> 'truefoundry'
  `.execute(db);
}
