/**
 * Runtime sandbox-provider construction + live sandbox-image status.
 *
 * The sandbox image is release-owned (baked into the harness package), so its
 * build status is never persisted. This module builds a provider client from the
 * stored manifest and reads the image status live — used by the settings GET,
 * capabilities, and the turn path. Nothing here writes to the database.
 */
import { Daytona, DaytonaError } from '@daytona/sdk';
import { DaytonaSandboxProvider, type SandboxImageBuild } from '@truefoundry/utils-core/core';
import type { Logger } from 'winston';
import configuration from '../config';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import { toDaytonaSandboxProviderInput, type SandboxImage, type SandboxProviderManifest } from '../schemas/sandboxProvider';

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
    fileMaxBytesForDownload: configuration.SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD,
    logger,
  });
}

/** Maps the provider's build handle onto the wire `image` shape (drops the internal error text). */
export function toSandboxImage(build: SandboxImageBuild): SandboxImage {
  return { tag: build.tag, build_status: build.status, build_ref: build.ref };
}

/**
 * Live image build status for the configured provider, or undefined when no
 * provider is configured. Reads from the provider on every call — never the DB.
 */
export async function sandboxImageStatus({
  store,
  tenant_id,
  logger,
}: {
  store: ISandboxProviderStore;
  tenant_id: string;
  logger: Logger;
}): Promise<SandboxImageBuild | undefined> {
  const record = await store.getSandboxProvider(tenant_id);
  if (record === undefined) {
    return undefined;
  }
  const provider = getSandboxProvider({ manifest: record.manifest, tenant_id, logger });
  return provider.getImageBuildStatus();
}
