/**
 * TrueFoundry-mode sandbox environments: `"default"` is a persisted row created on first
 * read, pinned to the shared provider snapshot. Custom env CRUD is plain persistence.
 *
 * When the shared provider does not support environments (TFY on-prem sandbox) there is no
 * env/snapshot concept — get/upsert no-op and nothing is ensured (list still returns
 * persistence leftovers).
 */
import type { TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import { createLogger } from 'winston';
import {
  SandboxEnvironmentNameConflictError,
  type CreateSandboxEnvironmentInput,
  type DeleteSandboxEnvironmentInput,
  type GetSandboxEnvironmentInput,
  type GetSandboxEnvironmentsByIdsInput,
  type GetSandboxEnvironmentVersionInput,
  type ISandboxEnvironmentStore,
  type ListSandboxEnvironmentsInput,
  type MarkSandboxEnvironmentVersionFailedInput,
  type MarkSandboxEnvironmentVersionReadyInput,
  type SandboxEnvironmentOwnership,
  type SandboxEnvironmentSecretRecord,
  type SandboxEnvironmentVersionForProgress,
  type SandboxEnvironmentVersionRecord,
  type SandboxEnvironmentWithVersion,
  type SetSandboxEnvironmentEnabledInput,
  type UpsertSandboxEnvironmentInput,
} from '../db/sandboxEnvironmentStore';
import { DEFAULT_SANDBOX_ENVIRONMENT_NAME } from '../schemas/sandboxEnvironment';
import { ensureTrueFoundryDefaultSandboxEnvironment } from './ensureTrueFoundryDefaultSandboxEnvironment';
import { trueFoundryManaged } from './errors';

const logger = createLogger({ defaultMeta: { module: 'TrueFoundrySandboxEnvironmentStore' } });

export interface TrueFoundrySandboxEnvironmentStoreOptions {
  /**
   * From the shared sandbox provider's `envSupported` (Daytona true; TFY on-prem false).
   * When false, env CRUD/progress no-ops and the default row is not created.
   */
  envSupported: boolean;
}

/**
 * Wraps persistence for custom envs; `"default"` is created on demand when env is supported.
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

  /** Create the tenant default before a read that may be the first touch for this tenant. */
  async #ensureDefault(tenant_id: string, transaction?: TTransaction): Promise<void> {
    if (!this.#envSupported) {
      return;
    }
    await ensureTrueFoundryDefaultSandboxEnvironment({
      persistence: this.#persistence,
      tenant_id,
      ...(transaction === undefined ? {} : { transaction }),
    });
  }

  async listEnvironments(
    input: ListSandboxEnvironmentsInput,
    transaction?: TTransaction,
  ): Promise<{ data: SandboxEnvironmentWithVersion[]; pagination: TokenPagination }> {
    await this.#ensureDefault(input.tenant_id, transaction);
    return this.#persistence.listEnvironments(input, transaction);
  }

  async getEnvironment(
    input: GetSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    if (!this.#envSupported) {
      logger.info('Skipping sandbox environment get (provider does not support environments)', {
        name: input.name,
        tenant_id: input.tenant_id,
      });
      return undefined;
    }
    await this.#ensureDefault(input.tenant_id, transaction);
    return this.#persistence.getEnvironment(input, transaction);
  }

  async getEnvironmentsByIds(
    input: GetSandboxEnvironmentsByIdsInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentOwnership[]> {
    await this.#ensureDefault(input.tenant_id, transaction);
    return this.#persistence.getEnvironmentsByIds(input, transaction);
  }

  async getActiveEnvironment(
    input: GetSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    if (!this.#envSupported) {
      logger.info('Skipping active sandbox environment get (provider does not support environments)', {
        name: input.name,
        tenant_id: input.tenant_id,
      });
      return undefined;
    }
    await this.#ensureDefault(input.tenant_id, transaction);
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
    // The platform owns the default tip; only ensure may write it.
    if (input.name === DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      return trueFoundryManaged();
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

  async setEnvironmentEnabled(
    input: SetSandboxEnvironmentEnabledInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    if (!this.#envSupported) {
      logger.info('Skipping sandbox environment enable toggle (provider does not support environments)', {
        name: input.name,
        tenant_id: input.tenant_id,
      });
      return undefined;
    }
    await this.#ensureDefault(input.tenant_id, transaction);
    return this.#persistence.setEnvironmentEnabled(input, transaction);
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
