/**
 * Ensure the tenant `"default"` sandbox environment exists for a configured provider.
 */
import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import type { ISandboxEnvironmentStore, SandboxEnvironmentWithVersion } from '../db/sandboxEnvironmentStore';
import { NameSchema } from '../schemas/common';
import {
  DEFAULT_SANDBOX_ENVIRONMENT_NAME,
  SandboxEnvironmentVersionInternalMetadataSchema,
} from '../schemas/sandboxEnvironment';
import {
  defaultSandboxEnvironmentStoredManifest,
  newExternalRef,
  type SandboxEnvironmentProviderType,
} from './sandboxEnvironmentVersion';

const DEFAULT_NAME = NameSchema.parse(DEFAULT_SANDBOX_ENVIRONMENT_NAME);
const EMPTY_INTERNAL_METADATA = SandboxEnvironmentVersionInternalMetadataSchema.parse({});

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
      buildVersion: previous => ({
        version: previous ? previous.latest_version + 1 : 1,
        manifest: defaultSandboxEnvironmentStoredManifest(provider_type),
        status: 'pending',
        status_reason: null,
        external_ref: newExternalRef(),
        internal_metadata: EMPTY_INTERNAL_METADATA,
        created_by_subject,
      }),
    },
    transaction,
  );
}
