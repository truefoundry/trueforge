/** Sandbox provider construction + credential validation. */
import { Daytona, DaytonaError } from '@daytona/sdk';
import {
  createDaytonaSandboxEnvironment,
  DaytonaSandboxProvider,
  TFYSandboxProvider,
  type DaytonaSandboxEnvironment,
  type SandboxBuild,
} from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import configuration from '../config';
import type { SandboxProviderRecord } from '../db/sandboxProviderStore';
import type { StoredSandboxEnvironmentManifest } from '../schemas/sandboxEnvironment';
import {
  toDaytonaSandboxProviderInput,
  type SandboxStatus,
  type StoredSandboxProviderManifest,
} from '../schemas/sandboxProvider';

/** Bound Daytona RPCs so API requests and controller ticks cannot hang indefinitely. */
export const DAYTONA_RPC_TIMEOUT_MS = 5_000;

/** Provider rejected the credentials (401 unauthorized); retrying the same key cannot succeed. */
export function isDaytonaAuthError(error: unknown): boolean {
  return error instanceof DaytonaError && error.statusCode === 401;
}

export function isDaytonaPermissionError(error: unknown): boolean {
  return error instanceof DaytonaError && error.statusCode === 403;
}

export function isDaytonaNotFoundError(error: unknown): boolean {
  return error instanceof DaytonaError && error.statusCode === 404;
}

export function getDaytonaAuthorizationErrorMessage(error: unknown): string | undefined {
  if (isDaytonaAuthError(error)) {
    return 'Sandbox provider rejected the API key — check the credentials';
  }
  if (isDaytonaPermissionError(error)) {
    return 'Sandbox provider denied access: the API key is missing required permissions';
  }
  return undefined;
}

/** Configured tenant sandbox backends (not local fallback). */
export type ResolvedSandboxProvider = DaytonaSandboxProvider | TFYSandboxProvider;

/** Map a ready env (external_ref + stored manifest) onto Daytona create/build input data. */
export function toSandboxEnvironment({
  external_ref,
  manifest,
  mounted_secrets,
}: {
  external_ref: string;
  manifest: StoredSandboxEnvironmentManifest;
  /** env var → Daytona org secret name for create mounts. */
  mounted_secrets?: Record<string, string>;
}): DaytonaSandboxEnvironment {
  return createDaytonaSandboxEnvironment({
    snapshot_ref: external_ref,
    resources: manifest.resources,
    ...(manifest.image ? { image: manifest.image } : {}),
    ...(manifest.environment_variables ? { environment_variables: manifest.environment_variables } : {}),
    ...(mounted_secrets ? { mounted_secrets } : {}),
    ...(manifest.networking
      ? {
          networking: {
            ...(manifest.networking.network_block_all
              ? { network_block_all: manifest.networking.network_block_all }
              : {}),
            ...(manifest.networking.domain_allow_list
              ? { domain_allow_list: manifest.networking.domain_allow_list }
              : {}),
            ...(manifest.networking.secrets ? { secrets: manifest.networking.secrets } : {}),
          },
        }
      : {}),
  });
}

/**
 * Builds the Daytona runtime provider for a stored Daytona manifest. No network I/O until a method is called.
 * Snapshot tips (ref + image) are create/build input data, not provider config.
 */
export function toDaytonaSandboxProvider({
  manifest,
  tenant_id,
  logger,
}: {
  manifest: StoredSandboxProviderManifest;
  tenant_id: string;
  logger: Logger;
}): DaytonaSandboxProvider {
  if (manifest.type !== 'daytona') {
    throw new Error('Daytona sandbox provider required');
  }
  const { apiKey, ...settings } = toDaytonaSandboxProviderInput(manifest);
  return new DaytonaSandboxProvider({
    client: new Daytona({ apiKey }),
    apiKey,
    ...settings,
    tenantName: tenant_id,
    fileMaxBytesForDownload: configuration.SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD,
    logger,
  });
}

/**
 * Builds the runtime SandboxProvider for a store record. One switch on `manifest.type`.
 * No network I/O until a provider method is called.
 */
export function toSandboxProviderFromRecord({
  record,
  tenant_id,
  logger,
}: {
  record: SandboxProviderRecord;
  tenant_id: string;
  logger: Logger;
}): ResolvedSandboxProvider {
  switch (record.manifest.type) {
    case 'daytona':
      return toDaytonaSandboxProvider({
        manifest: record.manifest,
        tenant_id,
        logger,
      });
    case 'truefoundry':
      return new TFYSandboxProvider({
        serverUrl: record.manifest.server_url,
        natsBridgeUrl: record.manifest.nats_bridge_url,
        tenantName: tenant_id,
        fileMaxBytesForDownload: configuration.SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD,
        defaultExecTimeoutMs: record.manifest.exec_timeout_ms,
        logger,
      });
  }
}

/**
 * Credential/access probe via the provider's `validateAccess` (no-op when unimplemented).
 */
export async function validateSandboxProviderAccess({
  manifest,
  tenant_id,
  logger,
}: {
  manifest: StoredSandboxProviderManifest;
  tenant_id: string;
  logger: Logger;
}): Promise<void> {
  switch (manifest.type) {
    case 'daytona': {
      const provider = toDaytonaSandboxProvider({ manifest, tenant_id, logger });
      await provider.validateAccess();
      return;
    }
    case 'truefoundry':
      return;
  }
}

/** Maps a core `SandboxBuild` onto the persisted/wire status shape (metadata passes through). */
export function toSandboxStatus(build: SandboxBuild): SandboxStatus {
  return {
    status: build.status,
    status_reason: build.reason,
    build_metadata: build.metadata,
  };
}
