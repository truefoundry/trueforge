/**
 * Ensure the tenant `"default"` sandbox environment exists for a configured provider.
 */
import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import type { ISandboxEnvironmentStore, SandboxEnvironmentWithVersion } from '../db/sandboxEnvironmentStore';
import { NameSchema } from '../schemas/common';
import { DEFAULT_SANDBOX_ENVIRONMENT_NAME } from '../schemas/sandboxEnvironment';
import {
  buildNextVersion,
  defaultSandboxEnvironmentStoredManifest,
  type SandboxEnvironmentProviderType,
} from './sandboxEnvironmentVersion';

const DEFAULT_NAME = NameSchema.parse(DEFAULT_SANDBOX_ENVIRONMENT_NAME);

/**
 * Returns the existing default env, or creates it / appends a new pending version.
 * Pass `resetPending` when the provider API key rotated.
 */
export async function ensureDefaultSandboxEnvironment<TTransaction>({
  store,
  tenant_id,
  created_by_subject,
  provider_type,
  resetPending,
  transaction,
}: {
  store: ISandboxEnvironmentStore<TTransaction>;
  tenant_id: string;
  created_by_subject: CreatedBySubject;
  provider_type: SandboxEnvironmentProviderType;
  resetPending: boolean;
  transaction?: TTransaction;
}): Promise<SandboxEnvironmentWithVersion> {
  const existing = await store.getEnvironment({ tenant_id, name: DEFAULT_SANDBOX_ENVIRONMENT_NAME }, transaction);
  if (existing !== undefined && !resetPending) {
    return existing;
  }
  return store.upsertEnvironment(
    {
      tenant_id,
      name: DEFAULT_NAME,
      description: '',
      created_by_subject,
      synced_secrets: [],
      buildVersion: ({ existing_version, existing_manifest, existing_external_ref }) =>
        Promise.resolve({
          ...buildNextVersion({
            ...(existing_version !== undefined ? { existing_version } : {}),
            ...(existing_manifest ? { previous_manifest: existing_manifest } : {}),
            ...(existing_external_ref ? { previous_external_ref: existing_external_ref } : {}),
            manifest: defaultSandboxEnvironmentStoredManifest(provider_type),
            provider_type,
          }),
          created_by_subject,
        }),
    },
    transaction,
  );
}
