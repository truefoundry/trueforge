import type { Subject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import { createLogger } from 'winston';
import {
  SandboxEnvironmentNameConflictError,
  SandboxEnvironmentVersionConflictError,
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
  type SetDefaultSandboxEnvironmentInput,
  type SetSandboxEnvironmentEnabledInput,
  type UpsertSandboxEnvironmentInput,
} from '../db/sandboxEnvironmentStore';
import {
  reservedSandboxEnvironmentStoredManifest,
  resolveSandboxEnvironmentIdentity,
} from '../sandbox/environment/version';
import { NameSchema } from '../schemas/common';
import { RESERVED_SANDBOX_ENVIRONMENT_NAME } from '../schemas/sandboxEnvironment';
import { sandboxEnvironmentsNotSupported, trueFoundryManaged } from './errors';
import { resolveTrueFoundrySandboxProviderConfig } from './resolveTrueFoundrySandboxProviderConfig';

const logger = createLogger({ defaultMeta: { module: 'TrueFoundrySandboxEnvironmentStore' } });

const RESERVED_NAME = NameSchema.parse(RESERVED_SANDBOX_ENVIRONMENT_NAME);
const SYSTEM_SUBJECT: Subject = {
  subject_id: 'truefoundry',
  subject_type: 'user',
  subject_display_name: 'TrueFoundry',
};

export interface TrueFoundrySandboxEnvironmentStoreOptions {
  /**
   * From the shared sandbox provider's `envSupported` (Daytona true; TFY on-prem false).
   * When false, env CRUD/progress no-ops and the reserved row is never materialised.
   */
  envSupported: boolean;
}

export class TrueFoundrySandboxEnvironmentStore<
  TTransaction = never,
> implements ISandboxEnvironmentStore<TTransaction> {
  readonly #persistence: ISandboxEnvironmentStore<TTransaction>;
  readonly #envSupported: boolean;

  constructor(persistence: ISandboxEnvironmentStore<TTransaction>, options: TrueFoundrySandboxEnvironmentStoreOptions) {
    this.#persistence = persistence;
    this.#envSupported = options.envSupported;
  }

  /* Ensure the reserved environment is present. */
  async #ensureReserved(tenant_id: string, transaction?: TTransaction): Promise<void> {
    if (!this.#envSupported) {
      return;
    }
    const provider = resolveTrueFoundrySandboxProviderConfig();
    if (provider?.type !== 'daytona') {
      throw new Error('TrueFoundry Daytona sandbox provider is not configured');
    }
    const external_ref = provider.settings.snapshotName;
    const identity = resolveSandboxEnvironmentIdentity(provider.type);
    const store = this.#persistence;

    const existing = await store.getEnvironment({ tenant_id, name: RESERVED_SANDBOX_ENVIRONMENT_NAME }, transaction);
    if (existing?.version.status === 'ready' && existing.version.external_ref === external_ref) {
      return;
    }

    try {
      await store.upsertEnvironment(
        {
          tenant_id,
          name: RESERVED_NAME,
          description: '',
          created_by_subject: SYSTEM_SUBJECT,
          synced_secrets: [],
          // Written `ready`, not `pending`: the platform owns this snapshot, so the build
          // controller must never queue it.
          buildVersion: ({ existing_version }) =>
            Promise.resolve({
              version: (existing_version ?? 0) + 1,
              manifest: reservedSandboxEnvironmentStoredManifest(identity),
              status: 'ready',
              status_reason: null,
              external_ref,
              created_by_subject: SYSTEM_SUBJECT,
            }),
        },
        transaction,
      );
    } catch (error) {
      // Peer upsert won the race; callers re-read after ensure.
      if (
        !(error instanceof SandboxEnvironmentNameConflictError) &&
        !(error instanceof SandboxEnvironmentVersionConflictError)
      ) {
        throw error;
      }
    }
  }

  async listEnvironments(
    input: ListSandboxEnvironmentsInput,
    transaction?: TTransaction,
  ): Promise<{ data: SandboxEnvironmentWithVersion[]; pagination: TokenPagination }> {
    // No env/snapshot concept — persistence only (e.g. leftovers after a flip).
    if (!this.#envSupported) {
      return this.#persistence.listEnvironments(input, transaction);
    }
    await this.#ensureReserved(input.tenant_id, transaction);
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
    if (input.name === RESERVED_SANDBOX_ENVIRONMENT_NAME) {
      await this.#ensureReserved(input.tenant_id, transaction);
    }
    return this.#persistence.getEnvironment(input, transaction);
  }

  getEnvironmentsByIds(
    input: GetSandboxEnvironmentsByIdsInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentOwnership[]> {
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
    if (input.name === RESERVED_SANDBOX_ENVIRONMENT_NAME) {
      await this.#ensureReserved(input.tenant_id, transaction);
    }
    return this.#persistence.getActiveEnvironment(input, transaction);
  }

  async getDefaultEnvironment(
    input: { tenant_id: string },
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    if (!this.#envSupported) {
      return undefined;
    }
    await this.#ensureReserved(input.tenant_id, transaction);
    return this.#persistence.getDefaultEnvironment(input, transaction);
  }

  async hasUsableEnvironment(input: { tenant_id: string }, transaction?: TTransaction): Promise<boolean> {
    if (!this.#envSupported) {
      return false;
    }
    await this.#ensureReserved(input.tenant_id, transaction);
    return this.#persistence.hasUsableEnvironment(input, transaction);
  }

  async setEnvironmentEnabled(
    input: SetSandboxEnvironmentEnabledInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    if (!this.#envSupported) {
      return sandboxEnvironmentsNotSupported();
    }
    return this.#persistence.setEnvironmentEnabled(input, transaction);
  }

  async setDefaultEnvironment(
    input: SetDefaultSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    if (!this.#envSupported) {
      return sandboxEnvironmentsNotSupported();
    }
    await this.#ensureReserved(input.tenant_id, transaction);
    return this.#persistence.setDefaultEnvironment(input, transaction);
  }

  async clearDefaultEnvironment(
    input: SetDefaultSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    if (!this.#envSupported) {
      return sandboxEnvironmentsNotSupported();
    }
    return this.#persistence.clearDefaultEnvironment(input, transaction);
  }

  createEnvironment(
    input: CreateSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion> {
    if (!this.#envSupported) {
      logger.info('Rejecting sandbox environment create (provider does not support environments)', {
        name: input.name,
        tenant_id: input.tenant_id,
      });
      return sandboxEnvironmentsNotSupported();
    }
    if (input.name === RESERVED_SANDBOX_ENVIRONMENT_NAME) {
      return Promise.reject(new SandboxEnvironmentNameConflictError({ tenant_id: input.tenant_id, name: input.name }));
    }
    return this.#persistence.createEnvironment(input, transaction);
  }

  upsertEnvironment(
    input: UpsertSandboxEnvironmentInput,
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentWithVersion> {
    if (!this.#envSupported) {
      logger.info('Rejecting sandbox environment upsert (provider does not support environments)', {
        name: input.name,
        tenant_id: input.tenant_id,
      });
      return sandboxEnvironmentsNotSupported();
    }
    // The platform owns this row's manifest and tip; only ensure may write it.
    if (input.name === RESERVED_SANDBOX_ENVIRONMENT_NAME) {
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

  deleteEnvironment(input: DeleteSandboxEnvironmentInput): Promise<string | undefined> {
    if (!this.#envSupported) {
      logger.info('Skipping sandbox environment delete (provider does not support environments)', {
        name: input.name,
        tenant_id: input.tenant_id,
      });
      return Promise.resolve(undefined);
    }
    if (input.name === RESERVED_SANDBOX_ENVIRONMENT_NAME) {
      return trueFoundryManaged();
    }
    return this.#persistence.deleteEnvironment(input);
  }

  listSecretsByEnvironment(
    input: { environment_id: string },
    transaction?: TTransaction,
  ): Promise<SandboxEnvironmentSecretRecord[]> {
    return this.#persistence.listSecretsByEnvironment(input, transaction);
  }

  deleteSecretsByEnvironment(input: { environment_id: string }, transaction?: TTransaction): Promise<void> {
    return this.#persistence.deleteSecretsByEnvironment(input, transaction);
  }
}
