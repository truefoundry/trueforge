/** Sandbox provider construction + Daytona snapshot status refresh. */
import { Daytona, DaytonaError } from '@daytona/sdk';
import {
  DaytonaSandboxProvider,
  SANDBOX_IMAGE_URI,
  TFYSandboxProvider,
  withTimeout,
  type SandboxBuild,
  type SandboxProvider,
} from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import configuration from '../config';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../db/sandboxProviderStore';
import {
  toDaytonaSandboxProviderInput,
  type SandboxBuildMetadata,
  type SandboxProviderManifest,
  type SandboxStatus,
} from '../schemas/sandboxProvider';

/** Daytona rejected the credentials (401 unauthorized); retrying the same key cannot succeed. */
export function isDaytonaAuthError(error: unknown): boolean {
  return error instanceof DaytonaError && error.statusCode === 401;
}

export function isDaytonaPermissionError(error: unknown): boolean {
  return error instanceof DaytonaError && error.statusCode === 403;
}

export function daytonaAccessFailureReason(error: unknown): string | undefined {
  if (isDaytonaAuthError(error)) {
    return 'Daytona rejected the configured API key.';
  }
  if (isDaytonaPermissionError(error)) {
    return 'Daytona denied access to the configured API key.';
  }
  return undefined;
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
}: {
  manifest: SandboxProviderManifest;
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
}): SandboxProvider {
  switch (record.manifest.type) {
    case 'daytona':
      return toDaytonaSandboxProvider({
        manifest: record.manifest,
        tenant_id,
        logger,
        build_metadata: record.build_metadata,
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

/** Cap the Daytona round-trip for the refresh, which runs outside a transaction. */
const STATUS_REFRESH_TIMEOUT_MS = 60_000;

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

  // Prebuilt image — no snapshot registration or refresh.
  if (record.manifest.type === 'truefoundry') {
    return persisted;
  }

  const readyIsFresh =
    record.status === 'ready' && Date.now() - Date.parse(record.updated_at) < READY_REVALIDATE_INTERVAL_MS;
  if (record.status === 'failed' || readyIsFresh) {
    return persisted;
  }

  const provider = toDaytonaSandboxProvider({
    manifest: record.manifest,
    tenant_id,
    logger,
    build_metadata: record.build_metadata,
  });
  let build: SandboxBuild;
  try {
    if (record.status === 'ready') {
      // this is because image may have deactivated
      build = await withTimeout(provider.buildImage(), STATUS_REFRESH_TIMEOUT_MS, 'sandbox buildImage');
    } else {
      build = await withTimeout(
        provider.getImageBuildStatus(),
        STATUS_REFRESH_TIMEOUT_MS,
        'sandbox getImageBuildStatus',
      );
    }
  } catch (error) {
    const status_reason = daytonaAccessFailureReason(error);
    if (status_reason === undefined) {
      throw error;
    }
    const failed: SandboxStatus = {
      status: 'failed',
      status_reason,
      build_metadata: record.build_metadata,
    };
    const updated = await store.updateSandboxStatus({ tenant_id, ...failed });
    return updated ? sandboxStatusFromRecord(updated) : failed;
  }
  const next = toSandboxStatus(build);
  const updated = await store.updateSandboxStatus({ tenant_id, ...next });
  return updated ? sandboxStatusFromRecord(updated) : next;
}
