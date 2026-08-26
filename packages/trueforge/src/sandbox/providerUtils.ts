/** Sandbox provider construction and persisted build-status refresh. */
import { Daytona, DaytonaError } from '@daytona/sdk';
import {
  DaytonaSandboxProvider,
  E2BSandboxProvider,
  SANDBOX_IMAGE_URI,
  isE2BAuthError,
  type SandboxBuild,
  type SandboxProvider,
} from '@truefoundry/trueforge-core/core';
import { E2B } from 'e2b';
import type { Logger } from 'winston';
import configuration from '../config';
import type { ISandboxProviderStore, SandboxProviderRecord } from '../db/sandboxProviderStore';
import {
  toDaytonaSandboxProviderInput,
  toE2BSandboxProviderInput,
  type DaytonaSandboxProvider as DaytonaSandboxProviderManifest,
  type E2BSandboxProvider as E2BSandboxProviderManifest,
  type SandboxBuildMetadata,
  type SandboxProviderManifest,
  type SandboxStatus,
} from '../schemas/sandboxProvider';

/** The selected provider rejected its credentials; retrying the same key cannot succeed. */
export function isSandboxProviderAuthError(params: {
  error: unknown;
  providerType: SandboxProviderManifest['type'];
}): boolean {
  switch (params.providerType) {
    case 'daytona':
      return (
        params.error instanceof DaytonaError && (params.error.statusCode === 401 || params.error.statusCode === 403)
      );
    case 'e2b':
      return isE2BAuthError(params.error);
  }
}

/** Builds a Daytona runtime provider without performing network I/O. */
export function toDaytonaSandboxProvider(params: {
  manifest: DaytonaSandboxProviderManifest;
  tenant_id: string;
  logger: Logger;
  build_metadata?: SandboxBuildMetadata | null | undefined;
}): DaytonaSandboxProvider {
  const { apiKey, ...settings } = toDaytonaSandboxProviderInput(params.manifest);
  return new DaytonaSandboxProvider({
    client: new Daytona({ apiKey }),
    apiKey,
    ...settings,
    tenantName: params.tenant_id,
    sandboxImage: params.build_metadata?.['image_uri'] ?? SANDBOX_IMAGE_URI,
    buildRef: params.build_metadata?.['build_ref'],
    fileMaxBytesForDownload: configuration.SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD,
    logger: params.logger,
  });
}

/** Builds an E2B runtime provider without performing network I/O. */
export function toE2BSandboxProvider(params: {
  manifest: E2BSandboxProviderManifest;
  tenant_id: string;
  logger: Logger;
  build_metadata?: SandboxBuildMetadata | null | undefined;
}): E2BSandboxProvider {
  const { apiKey, ...settings } = toE2BSandboxProviderInput(params.manifest);
  return new E2BSandboxProvider({
    client: new E2B({ apiKey }),
    ...settings,
    tenantName: params.tenant_id,
    sandboxImage: params.build_metadata?.['image_uri'] ?? SANDBOX_IMAGE_URI,
    buildRef: params.build_metadata?.['build_ref'],
    buildId: params.build_metadata?.['build_id'],
    templateId: params.build_metadata?.['template_id'],
    fileMaxBytesForDownload: configuration.SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD,
    logger: params.logger,
  });
}

/** Dispatches a persisted manifest to its runtime provider. */
export function toSandboxProvider(params: {
  manifest: SandboxProviderManifest;
  tenant_id: string;
  logger: Logger;
  build_metadata?: SandboxBuildMetadata | null | undefined;
}): SandboxProvider {
  switch (params.manifest.type) {
    case 'daytona':
      return toDaytonaSandboxProvider({ ...params, manifest: params.manifest });
    case 'e2b':
      return toE2BSandboxProvider({ ...params, manifest: params.manifest });
  }
}

/** Maps a core build onto the persisted/wire status shape. */
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
const DAYTONA_READY_REVALIDATE_INTERVAL_MS = 13 * 24 * 60 * 60 * 1000;

export async function checkSandboxProviderStatus(params: {
  store: ISandboxProviderStore;
  tenant_id: string;
  logger: Logger;
}): Promise<SandboxStatus | undefined> {
  const record = await params.store.getSandboxProvider(params.tenant_id);
  if (record === undefined) {
    return undefined;
  }

  const persisted = sandboxStatusFromRecord(record);
  if (record.status === 'failed') {
    return persisted;
  }

  if (record.status === 'ready') {
    const daytonaReadyIsStale =
      record.manifest.type === 'daytona' &&
      Date.now() - Date.parse(record.updated_at) >= DAYTONA_READY_REVALIDATE_INTERVAL_MS;
    if (!daytonaReadyIsStale) {
      return persisted;
    }
  }

  const provider = toSandboxProvider({
    manifest: record.manifest,
    tenant_id: params.tenant_id,
    logger: params.logger,
    build_metadata: record.build_metadata,
  });
  const build = record.status === 'ready' ? await provider.buildImage() : await provider.getImageBuildStatus();
  const next = toSandboxStatus(build);
  const updated = await params.store.updateSandboxStatus({ tenant_id: params.tenant_id, ...next });
  return updated === undefined ? next : sandboxStatusFromRecord(updated);
}
