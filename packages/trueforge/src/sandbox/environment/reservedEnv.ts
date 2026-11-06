import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import { type ISandboxEnvironmentStore, type SandboxEnvironmentWithVersion } from '../../db/sandboxEnvironmentStore';
import { NameSchema } from '../../schemas/common';
import { RESERVED_SANDBOX_ENVIRONMENT_NAME, type SandboxEnvironmentIdentity } from '../../schemas/sandboxEnvironment';
import { buildNextVersion, reservedSandboxEnvironmentStoredManifest } from './version';

const RESERVED_NAME = NameSchema.parse(RESERVED_SANDBOX_ENVIRONMENT_NAME);

/**
 * Returns the existing reserved env, or creates it / appends a new pending version.
 * Pass `resetPending` when the provider API key rotated.
 */
export async function ensureReservedSandboxEnvironment<TTransaction>({
  store,
  tenant_id,
  created_by_subject,
  identity,
  resetPending,
  transaction,
}: {
  store: ISandboxEnvironmentStore<TTransaction>;
  tenant_id: string;
  created_by_subject: CreatedBySubject;
  identity: SandboxEnvironmentIdentity;
  resetPending: boolean;
  transaction?: TTransaction;
}): Promise<SandboxEnvironmentWithVersion> {
  const existing = await store.getEnvironment({ tenant_id, name: RESERVED_SANDBOX_ENVIRONMENT_NAME }, transaction);
  if (existing !== undefined && !resetPending) {
    return existing;
  }
  return store.upsertEnvironment(
    {
      tenant_id,
      name: RESERVED_NAME,
      description: '',
      created_by_subject,
      synced_secrets: [],
      buildVersion: ({ existing_version, existing_manifest, existing_external_ref }) =>
        Promise.resolve({
          ...buildNextVersion({
            ...(existing_version !== undefined ? { existing_version } : {}),
            ...(existing_manifest ? { previous_manifest: existing_manifest } : {}),
            ...(existing_external_ref ? { previous_external_ref: existing_external_ref } : {}),
            manifest: reservedSandboxEnvironmentStoredManifest(identity),
            identity,
          }),
          created_by_subject,
        }),
    },
    transaction,
  );
}
