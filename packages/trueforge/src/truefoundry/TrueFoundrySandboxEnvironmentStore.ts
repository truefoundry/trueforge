/**
 * TrueFoundry-mode sandbox environments: in-memory always-active `"default"`,
 * with custom env CRUD delegated to the persistence store.
 */
import type { TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import type {
  CreateDefaultSandboxEnvironmentInput,
  DeleteSandboxEnvironmentInput,
  GetDefaultSandboxEnvironmentInput,
  GetSandboxEnvironmentInput,
  GetSandboxEnvironmentVersionInput,
  ISandboxEnvironmentStore,
  ListLatestPendingSandboxEnvironmentVersionsInput,
  ListSandboxEnvironmentsInput,
  MarkSandboxEnvironmentVersionActiveInput,
  MarkSandboxEnvironmentVersionFailedInput,
  PendingSandboxEnvironmentVersion,
  SandboxEnvironmentVersionRecord,
  SandboxEnvironmentWithVersion,
  UpsertSandboxEnvironmentInput,
} from '../db/sandboxEnvironmentStore';
import { defaultSandboxEnvironmentStoredManifest } from '../sandbox/sandboxEnvironmentVersion';
import { NameSchema } from '../schemas/common';
import {
  DEFAULT_SANDBOX_ENVIRONMENT_NAME,
  SandboxEnvironmentVersionInternalMetadataSchema,
} from '../schemas/sandboxEnvironment';
import { trueFoundryManaged } from './errors';
import { resolveTrueFoundrySandboxProviderConfig } from './resolveTrueFoundrySandboxProviderConfig';

const DEFAULT_ENVIRONMENT_ID = 'tfy-default-sandbox-environment';
const DEFAULT_VERSION_ID = 'tfy-default-sandbox-environment-v1';

function synthesizeDefaultEnvironment(tenant_id: string): SandboxEnvironmentWithVersion | undefined {
  const providerConfig = resolveTrueFoundrySandboxProviderConfig();
  if (!providerConfig) {
    return undefined;
  }
  const now = new Date().toISOString();
  const provider_type = providerConfig.type === 'daytona' ? 'daytona' : 'truefoundry';
  const external_ref = providerConfig.type === 'daytona' ? providerConfig.settings.snapshotName : 'truefoundry-default';
  const created_by_subject = {
    subject_id: 'truefoundry',
    subject_type: 'user' as const,
    subject_display_name: 'TrueFoundry',
  };
  return {
    environment: {
      id: DEFAULT_ENVIRONMENT_ID,
      tenant_id,
      name: NameSchema.parse(DEFAULT_SANDBOX_ENVIRONMENT_NAME),
      description: '',
      active_version: 1,
      lifecycle_stage: 'active',
      created_by_subject,
      created_at: now,
      updated_at: now,
    },
    version: {
      id: DEFAULT_VERSION_ID,
      environment_id: DEFAULT_ENVIRONMENT_ID,
      version: 1,
      manifest: defaultSandboxEnvironmentStoredManifest(provider_type),
      status: 'active',
      status_reason: null,
      external_ref,
      internal_metadata: SandboxEnvironmentVersionInternalMetadataSchema.parse({}),
      created_by_subject,
      created_at: now,
      updated_at: now,
    },
  };
}

/**
 * Wraps persistence for custom envs; `"default"` is always in-memory when sandbox is enabled.
 */
export class TrueFoundrySandboxEnvironmentStore<
  TTransaction = never,
> implements ISandboxEnvironmentStore<TTransaction> {
  readonly #persistence: ISandboxEnvironmentStore<TTransaction>;

  constructor(persistence: ISandboxEnvironmentStore<TTransaction>) {
    this.#persistence = persistence;
  }

  listEnvironments(
    input: ListSandboxEnvironmentsInput,
    transaction?: TTransaction,
  ): Promise<{ data: SandboxEnvironmentWithVersion[]; pagination: TokenPagination }> {
    return this.#persistence.listEnvironments(input, transaction);
  }

  getEnvironment(
    input: GetSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    if (input.name === DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      return Promise.resolve(synthesizeDefaultEnvironment(input.tenant_id));
    }
    return this.#persistence.getEnvironment(input, transaction);
  }

  getDefaultEnvironment(
    input: GetDefaultSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    void transaction;
    return Promise.resolve(synthesizeDefaultEnvironment(input.tenant_id));
  }

  createDefaultEnvironment(
    input: CreateDefaultSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion> {
    void transaction;
    const synthesized = synthesizeDefaultEnvironment(input.tenant_id);
    if (synthesized) {
      return Promise.resolve(synthesized);
    }
    return trueFoundryManaged();
  }

  upsertEnvironment(
    input: UpsertSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion> {
    if (input.name === DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      return trueFoundryManaged();
    }
    return this.#persistence.upsertEnvironment(input, transaction);
  }

  listLatestPendingVersions(
    input: ListLatestPendingSandboxEnvironmentVersionsInput,
    transaction?: TTransaction,
  ): Promise<PendingSandboxEnvironmentVersion[]> {
    return this.#persistence.listLatestPendingVersions(input, transaction);
  }

  getVersionForProgress(
    input: GetSandboxEnvironmentVersionInput,
    transaction?: TTransaction,
  ): Promise<PendingSandboxEnvironmentVersion | undefined> {
    return this.#persistence.getVersionForProgress(input, transaction);
  }

  markVersionActive(
    input: MarkSandboxEnvironmentVersionActiveInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    return this.#persistence.markVersionActive(input, transaction);
  }

  markVersionFailed(
    input: MarkSandboxEnvironmentVersionFailedInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentVersionRecord | undefined> {
    return this.#persistence.markVersionFailed(input, transaction);
  }

  deleteEnvironment(input: DeleteSandboxEnvironmentInput, transaction?: TTransaction): Promise<void> {
    if (input.name === DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      return trueFoundryManaged();
    }
    return this.#persistence.deleteEnvironment(input, transaction);
  }
}
