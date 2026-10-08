/**
 * TrueFoundry-mode sandbox environments: in-memory always-ready `"default"` when the
 * shared provider supports environments (Daytona); custom env CRUD delegated to persistence.
 *
 * When the shared provider does not support environments (TFY on-prem sandbox) there is no
 * env/snapshot concept — get/upsert/list-inject no-op (list still returns persistence leftovers).
 */
import type { TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import { encodeOffsetPageToken } from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import { createLogger } from 'winston';
import {
  SandboxEnvironmentNameConflictError,
  type CreateSandboxEnvironmentInput,
  type DeleteSandboxEnvironmentInput,
  type GetSandboxEnvironmentInput,
  type GetSandboxEnvironmentVersionInput,
  type ISandboxEnvironmentStore,
  type ListSandboxEnvironmentsInput,
  type MarkSandboxEnvironmentVersionFailedInput,
  type MarkSandboxEnvironmentVersionReadyInput,
  type SandboxEnvironmentSecretRecord,
  type SandboxEnvironmentVersionForProgress,
  type SandboxEnvironmentVersionRecord,
  type SandboxEnvironmentWithVersion,
  type UpsertSandboxEnvironmentInput,
} from '../db/sandboxEnvironmentStore';
import { DEFAULT_SANDBOX_ENVIRONMENT_NAME } from '../schemas/sandboxEnvironment';
import { trueFoundryManaged } from './errors';
import { synthesizeTrueFoundryDefaultSandboxEnvironment } from './synthesizeTrueFoundryDefaultSandboxEnvironment';

const logger = createLogger({ defaultMeta: { module: 'TrueFoundrySandboxEnvironmentStore' } });

export interface TrueFoundrySandboxEnvironmentStoreOptions {
  /**
   * From the shared sandbox provider's `envSupported` (Daytona true; TFY on-prem false).
   * When false, env CRUD/progress no-ops. Default tip comes from provider config via synthesize.
   */
  envSupported: boolean;
}

/**
 * Wraps persistence for custom envs; `"default"` is always in-memory when env is supported.
 */
export class TrueFoundrySandboxEnvironmentStore<
  TTransaction = never,
> implements ISandboxEnvironmentStore<TTransaction> {
  readonly #persistence: ISandboxEnvironmentStore<TTransaction>;
  readonly #envSupported: boolean;

  constructor(persistence: ISandboxEnvironmentStore<TTransaction>, options: TrueFoundrySandboxEnvironmentStoreOptions) {
    this.#persistence = persistence;
    this.#envSupported = options.envSupported;
  }

  async listEnvironments(
    input: ListSandboxEnvironmentsInput,
    transaction?: TTransaction,
  ): Promise<{ data: SandboxEnvironmentWithVersion[]; pagination: TokenPagination }> {
    // No env/snapshot concept — persistence only (e.g. leftovers after a flip).
    if (!this.#envSupported || input.page_token) {
      return this.#persistence.listEnvironments(input, transaction);
    }

    const synthesized = synthesizeTrueFoundryDefaultSandboxEnvironment(input.tenant_id);
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
    if (!this.#envSupported) {
      logger.info('Skipping sandbox environment get (provider does not support environments)', {
        name: input.name,
        tenant_id: input.tenant_id,
      });
      return Promise.resolve(undefined);
    }
    if (input.name === DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      return Promise.resolve(synthesizeTrueFoundryDefaultSandboxEnvironment(input.tenant_id));
    }
    return this.#persistence.getEnvironment(input, transaction);
  }

  getActiveEnvironment(
    input: GetSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    if (!this.#envSupported) {
      logger.info('Skipping active sandbox environment get (provider does not support environments)', {
        name: input.name,
        tenant_id: input.tenant_id,
      });
      return Promise.resolve(undefined);
    }
    if (input.name === DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      return Promise.resolve(synthesizeTrueFoundryDefaultSandboxEnvironment(input.tenant_id));
    }
    return this.#persistence.getActiveEnvironment(input, transaction);
  }

  createEnvironment(
    input: CreateSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion> {
    if (!this.#envSupported) {
      logger.info('Skipping sandbox environment create (provider does not support environments)', {
        name: input.name,
        tenant_id: input.tenant_id,
      });
      return trueFoundryManaged();
    }
    if (input.name === DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      return Promise.reject(new SandboxEnvironmentNameConflictError({ tenant_id: input.tenant_id, name: input.name }));
    }
    return this.#persistence.createEnvironment(input, transaction);
  }

  upsertEnvironment(
    input: UpsertSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion> {
    if (!this.#envSupported) {
      logger.info('Skipping sandbox environment upsert (provider does not support environments)', {
        name: input.name,
        tenant_id: input.tenant_id,
      });
      return trueFoundryManaged();
    }
    if (input.name === DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      return Promise.resolve(synthesizeTrueFoundryDefaultSandboxEnvironment(input.tenant_id));
    }
    return this.#persistence.upsertEnvironment(input, transaction);
  }

  listLatestPendingVersions(transaction?: TTransaction): Promise<string[]> {
    if (!this.#envSupported) {
      logger.info('Skipping pending sandbox environment list (provider does not support environments)');
      return Promise.resolve([]);
    }
    return this.#persistence.listLatestPendingVersions(transaction);
  }

  getSandboxEnvironmentVersion(
    input: GetSandboxEnvironmentVersionInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentVersionForProgress | undefined> {
    if (!this.#envSupported) {
      logger.info('Skipping sandbox environment version get (provider does not support environments)', {
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
    if (!this.#envSupported) {
      logger.info('Skipping sandbox environment mark ready (provider does not support environments)', {
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
    if (!this.#envSupported) {
      logger.info('Skipping sandbox environment mark failed (provider does not support environments)', {
        environment_version_id: input.environment_version_id,
      });
      return Promise.resolve(undefined);
    }
    return this.#persistence.markVersionFailed(input, transaction);
  }

  deleteEnvironment(input: DeleteSandboxEnvironmentInput, transaction?: TTransaction): Promise<void> {
    if (!this.#envSupported) {
      logger.info('Skipping sandbox environment delete (provider does not support environments)', {
        name: input.name,
        tenant_id: input.tenant_id,
      });
      return Promise.resolve();
    }
    if (input.name === DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      return trueFoundryManaged();
    }
    return this.#persistence.deleteEnvironment(input, transaction);
  }

  listSecretsByEnvironment(
    input: { environment_id: string },
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentSecretRecord[]> {
    return this.#persistence.listSecretsByEnvironment(input, transaction);
  }
}
