/**
 * Persisted `"default"` sandbox environment for TFY+Daytona, created on first read.
 * The tip (snapshot name) comes from shared provider config, so a platform snapshot
 * change is reconciled onto a new version rather than left stale on the row.
 */
import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import {
  SandboxEnvironmentNameConflictError,
  SandboxEnvironmentVersionConflictError,
  type ISandboxEnvironmentStore,
  type SandboxEnvironmentWithVersion,
} from '../db/sandboxEnvironmentStore';
import { defaultSandboxEnvironmentStoredManifest } from '../sandbox/sandboxEnvironmentVersion';
import { NameSchema } from '../schemas/common';
import { DEFAULT_SANDBOX_ENVIRONMENT_NAME } from '../schemas/sandboxEnvironment';
import { resolveTrueFoundrySandboxProviderConfig } from './resolveTrueFoundrySandboxProviderConfig';

const DEFAULT_NAME = NameSchema.parse(DEFAULT_SANDBOX_ENVIRONMENT_NAME);

const SYSTEM_SUBJECT: CreatedBySubject = {
  subject_id: 'truefoundry',
  subject_type: 'user',
  subject_display_name: 'TrueFoundry',
};

/** Snapshot the platform already owns, so the version is written ready and never queued for build. */
function resolveSnapshotName(): string {
  const provider = resolveTrueFoundrySandboxProviderConfig();
  if (provider?.type !== 'daytona') {
    throw new Error('TrueFoundry Daytona sandbox provider is not configured');
  }
  return provider.settings.snapshotName;
}

function isConcurrentWrite(error: unknown): boolean {
  return (
    error instanceof SandboxEnvironmentNameConflictError || error instanceof SandboxEnvironmentVersionConflictError
  );
}

/**
 * Returns the tenant `"default"` environment, creating it when missing and advancing it
 * onto the configured snapshot when the platform image changed. `enabled` lives on the
 * parent row, so neither path disturbs an admin's switch.
 */
export async function ensureTrueFoundryDefaultSandboxEnvironment<TTransaction>({
  persistence,
  tenant_id,
  transaction,
}: {
  persistence: ISandboxEnvironmentStore<TTransaction>;
  tenant_id: string;
  transaction?: TTransaction;
}): Promise<SandboxEnvironmentWithVersion> {
  const external_ref = resolveSnapshotName();
  const existing = await persistence.getEnvironment({ tenant_id, name: DEFAULT_SANDBOX_ENVIRONMENT_NAME }, transaction);
  if (existing?.version.external_ref === external_ref && existing.version.status === 'ready') {
    return existing;
  }

  const manifest = defaultSandboxEnvironmentStoredManifest('daytona');
  try {
    return await persistence.upsertEnvironment(
      {
        tenant_id,
        name: DEFAULT_NAME,
        description: '',
        created_by_subject: SYSTEM_SUBJECT,
        synced_secrets: [],
        buildVersion: ({ existing_version }) =>
          Promise.resolve({
            version: (existing_version ?? 0) + 1,
            manifest,
            status: 'ready',
            status_reason: null,
            external_ref,
            created_by_subject: SYSTEM_SUBJECT,
          }),
      },
      transaction,
    );
  } catch (error) {
    if (!isConcurrentWrite(error)) {
      throw error;
    }
    // A parallel first read won the insert; its row is equivalent.
    const row = await persistence.getEnvironment({ tenant_id, name: DEFAULT_SANDBOX_ENVIRONMENT_NAME }, transaction);
    if (row === undefined) {
      throw new Error('Default sandbox environment disappeared after a concurrent write', { cause: error });
    }
    return row;
  }
}
