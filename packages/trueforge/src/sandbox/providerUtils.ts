/** Sandbox provider construction + credential validation. */
import { Daytona, DaytonaError } from '@daytona/sdk';
import {
  DaytonaSandboxProvider,
  SANDBOX_IMAGE_URI,
  TFYSandboxProvider,
  type SandboxBuild,
  type SandboxEnvironment,
  type SandboxProvider,
} from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import configuration from '../config';
import type { SandboxProviderRecord } from '../db/sandboxProviderStore';
import type { StoredSandboxEnvironmentManifest } from '../schemas/sandboxEnvironment';
import {
  toDaytonaSandboxProviderInput,
  type SandboxBuildMetadata,
  type SandboxProviderManifest,
  type SandboxStatus,
  type StoredSandboxProviderManifest,
} from '../schemas/sandboxProvider';

/** Provider rejected the credentials (401 unauthorized); retrying the same key cannot succeed. */
export function isDaytonaAuthError(error: unknown): boolean {
  return error instanceof DaytonaError && error.statusCode === 401;
}

export function isDaytonaPermissionError(error: unknown): boolean {
  return error instanceof DaytonaError && error.statusCode === 403;
}

/** Map host sandbox-environment manifest onto the Daytona provider environment. */
export function toDaytonaSandboxEnvironment(manifest: StoredSandboxEnvironmentManifest): SandboxEnvironment {
  return {
    resources: manifest.resources,
    ...(manifest.image ? { image: manifest.image } : {}),
    ...(manifest.environment_variables ? { environment_variables: manifest.environment_variables } : {}),
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
  };
}

/**
 * Builds the Daytona runtime provider for a stored Daytona manifest. No network I/O until a method is called.
 *
 * When `build_metadata` is present, pin both `sandboxImage` and `buildRef` to what was actually
 * built — image bumps in the running binary must not rewrite an existing tenant onto a new
 * snapshot (upgrades are not supported yet). First-time configure omits metadata and uses
 * {@link SANDBOX_IMAGE_URI}.
 */
export function toDaytonaSandboxProvider({
  manifest,
  tenant_id,
  logger,
  build_metadata,
  environment,
}: {
  manifest: SandboxProviderManifest;
  tenant_id: string;
  logger: Logger;
  build_metadata?: SandboxBuildMetadata | null | undefined;
  environment?: StoredSandboxEnvironmentManifest | undefined;
}): DaytonaSandboxProvider {
  const { apiKey, ...settings } = toDaytonaSandboxProviderInput(manifest);
  const imageUri = build_metadata?.['image_uri'];
  const buildRef = build_metadata?.['build_ref'];
  return new DaytonaSandboxProvider({
    client: new Daytona({ apiKey }),
    apiKey,
    ...settings,
    tenantName: tenant_id,
    sandboxImage: imageUri ?? SANDBOX_IMAGE_URI,
    buildRef,
    fileMaxBytesForDownload: configuration.SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD,
    ...(environment ? { environment: toDaytonaSandboxEnvironment(environment) } : {}),
    logger,
  });
}

/**
 * Builds the runtime SandboxProvider for a store record. One switch on `manifest.type`.
 * No network I/O until a provider method is called.
 *
 * Optional `build_metadata` pins Daytona snapshot refs (e.g. env-version `external_ref`).
 */
export function toSandboxProviderFromRecord({
  record,
  tenant_id,
  logger,
  build_metadata,
}: {
  record: SandboxProviderRecord;
  tenant_id: string;
  build_metadata?: SandboxBuildMetadata | null | undefined;
  logger: Logger;
}): SandboxProvider {
  switch (record.manifest.type) {
    case 'daytona':
      return toDaytonaSandboxProvider({
        manifest: record.manifest,
        tenant_id,
        logger,
        build_metadata,
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
