/** Daytona provider construction + persisted build-status refresh (see checkSnapshotStatus). */
import { Daytona, DaytonaError } from '@daytona/sdk';
import {
  DaytonaSandboxProvider,
  PromiseTimeoutError,
  SANDBOX_IMAGE_URI,
  extractErrorLogFields,
  withTimeout,
  type SandboxBuild,
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

/** Daytona rejected the credentials (401 unauthorized / 403 forbidden); retrying the same key cannot succeed. */
export function isDaytonaAuthError(error: unknown): boolean {
  return error instanceof DaytonaError && (error.statusCode === 401 || error.statusCode === 403);
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

/**
 * Cap the Daytona round-trip so a slow or unreachable provider can't hold a request (or DB txn) open.
 *
 * One budget for both the settings write and the refresh below: they issue the same calls, and a
 * refresh sits on the capability probe and on turn creation, where a stall is felt sooner.
 */
export const SANDBOX_BUILD_REQUEST_TIMEOUT_MS = 3_000;

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
      build = await withTimeout(provider.buildImage(), SANDBOX_BUILD_REQUEST_TIMEOUT_MS, 'sandbox buildImage');
    } else {
      build = await withTimeout(
        provider.getImageBuildStatus(),
        SANDBOX_BUILD_REQUEST_TIMEOUT_MS,
        'sandbox getImageBuildStatus',
      );
    }
  } catch (error) {
    if (error instanceof PromiseTimeoutError) {
      /*
       * A refresh that cannot answer in time reports what was last persisted rather than failing
       * the caller. This runs on the capability probe, the settings read, and turn creation, none
       * of which are asking to talk to Daytona — they are asking for the current status, and a
       * stale answer serves them better than a hang or a 500 while the provider is unwell.
       */
      logger.warn('Sandbox image status refresh timed out; using last persisted status', {
        ...extractErrorLogFields(error),
        tenant_id,
      });
      return persisted;
    }
    throw error;
  }
  const next = toSandboxStatus(build);
  const updated = await store.updateSandboxStatus({ tenant_id, ...next });
  return updated ? sandboxStatusFromRecord(updated) : next;
}
