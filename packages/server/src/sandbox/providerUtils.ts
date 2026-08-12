/**
 * Runtime sandbox-provider construction + live sandbox build status. Builds a
 * provider client from the stored manifest and reads its build status live —
 * used by the settings GET, capabilities, and the turn path.
 */
import { Daytona, DaytonaError } from '@daytona/sdk';
import {
  DaytonaSandboxProvider,
  extractErrorLogFields,
  SANDBOX_IMAGE_NAME,
  type SandboxBuild,
} from '@truefoundry/utils-core/core';
import type { Logger } from 'winston';
import configuration from '../config';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import {
  toDaytonaSandboxProviderInput,
  type SandboxBuild as SandboxBuildWire,
  type SandboxProviderManifest,
} from '../schemas/sandboxProvider';

/** Daytona rejected the credentials (401 unauthorized / 403 forbidden); retrying the same key cannot succeed. */
export function isDaytonaAuthError(error: unknown): boolean {
  return error instanceof DaytonaError && (error.statusCode === 401 || error.statusCode === 403);
}

/** Builds the runtime provider for a stored manifest. No network I/O until a method is called. */
export function getSandboxProvider({
  manifest,
  tenant_id,
  logger,
}: {
  manifest: SandboxProviderManifest;
  tenant_id: string;
  logger: Logger;
}): DaytonaSandboxProvider {
  const { apiKey, ...settings } = toDaytonaSandboxProviderInput(manifest);
  return new DaytonaSandboxProvider({
    client: new Daytona({ apiKey }),
    ...settings,
    tenantName: tenant_id,
    sandboxImage: SANDBOX_IMAGE_NAME,
    fileMaxBytesForDownload: configuration.SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD,
    logger,
  });
}

/** Maps the provider's runtime build onto the snake_case wire shape. */
export function toSandboxBuild(build: SandboxBuild): SandboxBuildWire {
  return {
    status: build.status,
    reason: build.reason,
    metadata: { build_ref: build.metadata.buildRef, image_tag: build.metadata.imageTag },
  };
}

/**
 * Live wire build for a provider that never throws: a provider/Daytona failure is logged and
 * reported as a `failed` build, so GET can still serve the stored config (e.g. to rotate a bad key).
 */
export async function safeSandboxBuild({
  provider,
  logger,
}: {
  provider: DaytonaSandboxProvider;
  logger: Logger;
}): Promise<SandboxBuildWire> {
  try {
    return toSandboxBuild(await provider.getImageBuildStatus());
  } catch (error) {
    logger.warn('Live sandbox build status check failed; serving stored config', extractErrorLogFields(error));
    return {
      status: 'failed',
      reason: 'Could not fetch build status from the sandbox provider — check connectivity and credentials.',
      metadata: { build_ref: provider.buildMetadata.buildRef, image_tag: provider.buildMetadata.imageTag },
    };
  }
}

/** Live build status for the configured provider, or undefined when none is configured. */
export async function sandboxImageStatus({
  store,
  tenant_id,
  logger,
}: {
  store: ISandboxProviderStore;
  tenant_id: string;
  logger: Logger;
}): Promise<SandboxBuild | undefined> {
  const record = await store.getSandboxProvider(tenant_id);
  if (record === undefined) {
    return undefined;
  }
  const provider = getSandboxProvider({ manifest: record.manifest, tenant_id, logger });
  return provider.getImageBuildStatus();
}
