/**
 * In-memory always-ready `"default"` sandbox environment for TFY+Daytona.
 * Tip (snapshot name) comes from shared provider config — not from the env store.
 */
import type { SandboxEnvironmentWithVersion } from '../db/sandboxEnvironmentStore';
import { defaultSandboxEnvironmentStoredManifest } from '../sandbox/sandboxEnvironmentVersion';
import { NameSchema } from '../schemas/common';
import {
  DEFAULT_SANDBOX_ENVIRONMENT_NAME,
  SandboxEnvironmentVersionInternalMetadataSchema,
} from '../schemas/sandboxEnvironment';
import { resolveTrueFoundrySandboxProviderConfig } from './resolveTrueFoundrySandboxProviderConfig';

const DEFAULT_ENVIRONMENT_ID = 'tfy-default-sandbox-environment';
const DEFAULT_VERSION_ID = 'tfy-default-sandbox-environment-v1';
const DEFAULT_NAME = NameSchema.parse(DEFAULT_SANDBOX_ENVIRONMENT_NAME);
const SYSTEM_SUBJECT = {
  subject_id: 'truefoundry',
  subject_type: 'user' as const,
  subject_display_name: 'TrueFoundry',
};
const EMPTY_INTERNAL_METADATA = SandboxEnvironmentVersionInternalMetadataSchema.parse({});

/** Synthesize the platform default env row from Daytona shared-provider config. */
export function synthesizeTrueFoundryDefaultSandboxEnvironment(tenant_id: string): SandboxEnvironmentWithVersion {
  const provider = resolveTrueFoundrySandboxProviderConfig();
  if (provider?.type !== 'daytona') {
    throw new Error('TrueFoundry Daytona sandbox provider is not configured');
  }
  const now = new Date().toISOString();
  return {
    environment: {
      id: DEFAULT_ENVIRONMENT_ID,
      tenant_id,
      name: DEFAULT_NAME,
      description: '',
      active_version: 1,
      lifecycle_stage: 'active',
      created_by_subject: SYSTEM_SUBJECT,
      created_at: now,
      updated_at: now,
    },
    version: {
      id: DEFAULT_VERSION_ID,
      environment_id: DEFAULT_ENVIRONMENT_ID,
      version: 1,
      manifest: defaultSandboxEnvironmentStoredManifest('daytona'),
      status: 'ready',
      status_reason: null,
      external_ref: provider.settings.snapshotName,
      internal_metadata: EMPTY_INTERNAL_METADATA,
      created_by_subject: SYSTEM_SUBJECT,
      created_at: now,
      updated_at: now,
    },
  };
}
