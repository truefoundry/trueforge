/**
 * TrueFoundry-mode sandbox environments: in-memory always-ready `"default"`,
 * with custom env CRUD delegated to the persistence store.
 *
 * When `TRUEFOUNDRY_SANDBOX_PROVIDER=truefoundry`, custom env writes/progress no-op
 * (log and return). List still returns persistence customs so a provider flip remains visible.
 */
import type { TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import { encodeOffsetPageToken } from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import { createLogger } from 'winston';
import type {
  DeleteSandboxEnvironmentInput,
  GetSandboxEnvironmentInput,
  GetSandboxEnvironmentVersionInput,
  ISandboxEnvironmentStore,
  ListSandboxEnvironmentsInput,
  MarkSandboxEnvironmentVersionFailedInput,
  MarkSandboxEnvironmentVersionReadyInput,
  SandboxEnvironmentVersionForProgress,
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
import { isTfySandbox } from './isTfySandbox';
import { resolveTrueFoundrySandboxProviderConfig } from './resolveTrueFoundrySandboxProviderConfig';

const logger = createLogger({ defaultMeta: { module: 'TrueFoundrySandboxEnvironmentStore' } });

const DEFAULT_ENVIRONMENT_ID = 'tfy-default-sandbox-environment';
const DEFAULT_VERSION_ID = 'tfy-default-sandbox-environment-v1';
const DEFAULT_NAME = NameSchema.parse(DEFAULT_SANDBOX_ENVIRONMENT_NAME);
const SYSTEM_SUBJECT = {
  subject_id: 'truefoundry',
  subject_type: 'user' as const,
  subject_display_name: 'TrueFoundry',
};
const EMPTY_INTERNAL_METADATA = SandboxEnvironmentVersionInternalMetadataSchema.parse({});

/** In-memory always-ready tenant default (requires TFY sandbox provider config). */
function synthesizeDefaultEnvironment(tenant_id: string): SandboxEnvironmentWithVersion {
  const provider = resolveTrueFoundrySandboxProviderConfig();
  if (!provider) {
    throw new Error('TrueFoundry sandbox provider is not configured');
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
      manifest: defaultSandboxEnvironmentStoredManifest(provider.type),
      status: 'ready',
      status_reason: null,
      external_ref: provider.type === 'daytona' ? provider.settings.snapshotName : 'truefoundry-default',
      internal_metadata: EMPTY_INTERNAL_METADATA,
      created_by_subject: SYSTEM_SUBJECT,
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

  async listEnvironments(
    input: ListSandboxEnvironmentsInput,
    transaction?: TTransaction,
  ): Promise<{ data: SandboxEnvironmentWithVersion[]; pagination: TokenPagination }> {
    // Later pages: customs only (default was injected on page one).
    if (input.page_token) {
      return this.#persistence.listEnvironments(input, transaction);
    }

    const synthesized = synthesizeDefaultEnvironment(input.tenant_id);
    const withoutDefault = (rows: SandboxEnvironmentWithVersion[]) =>
      rows.filter(row => row.environment.name !== DEFAULT_SANDBOX_ENVIRONMENT_NAME);

    // First page: inject default; when limited, reserve one slot for it.
    const customLimit = input.limit === undefined ? undefined : Math.max(input.limit - 1, 0);
    if (customLimit === 0) {
      const peek = await this.#persistence.listEnvironments({ ...input, limit: 1 }, transaction);
      const hasMore = withoutDefault(peek.data).length > 0 || peek.pagination.next_page_token !== undefined;
      return {
        data: [synthesized],
        pagination: {
          limit: input.limit ?? 1,
          ...(hasMore ? { next_page_token: peek.pagination.next_page_token ?? encodeOffsetPageToken(0) } : {}),
        },
      };
    }

    const listed = await this.#persistence.listEnvironments(
      customLimit === undefined ? input : { ...input, limit: customLimit },
      transaction,
    );
    const customs = withoutDefault(listed.data);
    return {
      data: [synthesized, ...customs],
      pagination: customLimit === undefined ? { limit: customs.length + 1 } : listed.pagination,
    };
  }

  getEnvironment(
    input: GetSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    if (input.name === DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      return Promise.resolve(synthesizeDefaultEnvironment(input.tenant_id));
    }
    if (isTfySandbox()) {
      logger.info('Skipping custom sandbox environment get under TRUEFOUNDRY_SANDBOX_PROVIDER=truefoundry', {
        name: input.name,
        tenant_id: input.tenant_id,
      });
      return Promise.resolve(undefined);
    }
    return this.#persistence.getEnvironment(input, transaction);
  }

  upsertEnvironment(
    input: UpsertSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion> {
    if (input.name === DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      return Promise.resolve(synthesizeDefaultEnvironment(input.tenant_id));
    }
    if (isTfySandbox()) {
      logger.info('Skipping custom sandbox environment upsert under TRUEFOUNDRY_SANDBOX_PROVIDER=truefoundry', {
        name: input.name,
        tenant_id: input.tenant_id,
      });
      return trueFoundryManaged();
    }
    return this.#persistence.upsertEnvironment(input, transaction);
  }

  listLatestPendingVersions(transaction?: TTransaction): Promise<string[]> {
    if (isTfySandbox()) {
      logger.info('Skipping pending sandbox environment list under TRUEFOUNDRY_SANDBOX_PROVIDER=truefoundry');
      return Promise.resolve([]);
    }
    return this.#persistence.listLatestPendingVersions(transaction);
  }

  getSandboxEnvironmentVersion(
    input: GetSandboxEnvironmentVersionInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentVersionForProgress | undefined> {
    if (isTfySandbox()) {
      logger.info('Skipping sandbox environment version get under TRUEFOUNDRY_SANDBOX_PROVIDER=truefoundry', {
        environment_version_id: input.environment_version_id,
      });
      return Promise.resolve(undefined);
    }
    return this.#persistence.getSandboxEnvironmentVersion(input, transaction);
  }

  markVersionReady(
    input: MarkSandboxEnvironmentVersionReadyInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    if (isTfySandbox()) {
      logger.info('Skipping sandbox environment mark ready under TRUEFOUNDRY_SANDBOX_PROVIDER=truefoundry', {
        environment_version_id: input.environment_version_id,
      });
      return Promise.resolve(undefined);
    }
    return this.#persistence.markVersionReady(input, transaction);
  }

  markVersionFailed(
    input: MarkSandboxEnvironmentVersionFailedInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentVersionRecord | undefined> {
    if (isTfySandbox()) {
      logger.info('Skipping sandbox environment mark failed under TRUEFOUNDRY_SANDBOX_PROVIDER=truefoundry', {
        environment_version_id: input.environment_version_id,
      });
      return Promise.resolve(undefined);
    }
    return this.#persistence.markVersionFailed(input, transaction);
  }

  deleteEnvironment(input: DeleteSandboxEnvironmentInput, transaction?: TTransaction): Promise<void> {
    if (input.name === DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      return trueFoundryManaged();
    }
    if (isTfySandbox()) {
      logger.info('Skipping custom sandbox environment delete under TRUEFOUNDRY_SANDBOX_PROVIDER=truefoundry', {
        name: input.name,
        tenant_id: input.tenant_id,
      });
      return Promise.resolve();
    }
    return this.#persistence.deleteEnvironment(input, transaction);
  }
}
