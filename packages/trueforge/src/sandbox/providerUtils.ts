/** Sandbox-provider construction + persisted build-status refresh (see checkSnapshotStatus). */
import { Daytona, DaytonaError } from '@daytona/sdk';
import {
  DaytonaSandboxProvider,
  OpenSandboxProvider,
  SANDBOX_IMAGE_URI,
  type SandboxBuild,
  type SandboxProvider,
} from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import configuration from '../config';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../db/sandboxProviderStore';
import {
  toDaytonaSandboxProviderInput,
  toOpenSandboxProviderInput,
  type SandboxBuildMetadata,
  type SandboxProviderManifest,
  type SandboxStatus,
} from '../schemas/sandboxProvider';

/** Daytona rejected the credentials (401 unauthorized / 403 forbidden); retrying the same key cannot succeed. */
export function isDaytonaAuthError(error: unknown): boolean {
  return error instanceof DaytonaError && (error.statusCode === 401 || error.statusCode === 403);
}

export function isOpenSandboxAuthError(error: unknown): boolean {
  return error instanceof Error && 'statusCode' in error && (error.statusCode === 401 || error.statusCode === 403);
}

/**
 * Builds the runtime provider for a stored manifest. No network I/O until a method is called.
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
}: {
  manifest: Extract<SandboxProviderManifest, { type: 'daytona' }>;
  tenant_id: string;
  logger: Logger;
  build_metadata?: SandboxBuildMetadata | null;
}): DaytonaSandboxProvider {
  const { apiKey, ...settings } = toDaytonaSandboxProviderInput(manifest);
  return new DaytonaSandboxProvider({
    client: new Daytona({ apiKey }),
    apiKey,
    ...settings,
    tenantName: tenant_id,
    sandboxImage: build_metadata?.['image_uri'] ?? SANDBOX_IMAGE_URI,
    buildRef: build_metadata?.['build_ref'],
    fileMaxBytesForDownload: configuration.SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD,
    logger,
  });
}

function toOpenSandboxProvider({
  manifest,
  tenant_id,
  logger,
  build_metadata,
}: {
  manifest: Extract<SandboxProviderManifest, { type: 'opensandbox' }>;
  tenant_id: string;
  logger: Logger;
  build_metadata?: SandboxBuildMetadata | null;
}): OpenSandboxProvider {
  const settings = toOpenSandboxProviderInput(manifest);
  return new OpenSandboxProvider({
    ...settings,
    tenantName: tenant_id,
    sandboxImage: build_metadata?.['image_uri'] ?? SANDBOX_IMAGE_URI,
    fileMaxBytesForDownload: configuration.SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD,
    platform: { os: 'linux', arch: 'amd64' },
    entrypoint: ['/usr/bin/supervisord', '-n'],
    logger,
  });
}

/** Builds the concrete runtime provider selected by the stored manifest discriminator. */
export function toSandboxProvider({
  manifest,
  tenant_id,
  logger,
  build_metadata,
}: {
  manifest: SandboxProviderManifest;
  tenant_id: string;
  logger: Logger;
  build_metadata?: SandboxBuildMetadata | null;
}): SandboxProvider {
  if (manifest.type === 'daytona') {
    return toDaytonaSandboxProvider({
      manifest,
      tenant_id,
      logger,
      ...(build_metadata !== undefined ? { build_metadata } : {}),
    });
  }
  return toOpenSandboxProvider({
    manifest,
    tenant_id,
    logger,
    ...(build_metadata !== undefined ? { build_metadata } : {}),
  });
}

/** Maps a core `SandboxBuild` onto the persisted/wire status shape (metadata passes through). */
export function toSandboxStatus(build: SandboxBuild): SandboxStatus {
  return {
    status: build.status,
    status_reason: build.reason,
    build_metadata: build.metadata,
  };
}

function sandboxStatusFromRecord(record: SandboxProviderRecord): SandboxStatus {
  return {
    status: record.status,
    status_reason: record.status_reason,
    build_metadata: record.build_metadata,
  };
}

// Daytona deactivates idle snapshots after 14 days; revalidate at 13 to stay a day ahead.
const READY_REVALIDATE_INTERVAL_MS = 13 * 24 * 60 * 60 * 1000;

export async function checkSnapshotStatus({
  store,
  tenant_id,
  logger,
}: {
  store: ISandboxProviderStore;
  tenant_id: string;
  logger: Logger;
}): Promise<SandboxStatus | undefined> {
  const record = await store.getSandboxProvider(tenant_id);
  if (!record) {
    return undefined;
  }

  const persisted = sandboxStatusFromRecord(record);

  const readyIsFresh =
    record.status === 'ready' && Date.now() - Date.parse(record.updated_at) < READY_REVALIDATE_INTERVAL_MS;
  if (record.status === 'failed' || readyIsFresh) {
    return persisted;
  }

  const provider = toSandboxProvider({
    manifest: record.manifest,
    tenant_id,
    logger,
    build_metadata: record.build_metadata,
  });
  let build: SandboxBuild;
  if (record.status === 'ready') {
    // this is because image may have deactivated
    build = await provider.buildImage();
  } else {
    build = await provider.getImageBuildStatus();
  }
  const next = toSandboxStatus(build);
  const updated = await store.updateSandboxStatus({ tenant_id, ...next });
  return updated ? sandboxStatusFromRecord(updated) : next;
}
