/**
 * Progress a pending sandbox-environment version: get/create Daytona snapshot, update DB.
 */
import type { Logger } from 'winston';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import {
  isDaytonaAuthError,
  isDaytonaPermissionError,
  toDaytonaSandboxProvider,
  toSandboxStatus,
} from '../sandbox/providerUtils';

export async function progressSandboxEnvironmentVersion({
  sandboxEnvironmentStore,
  sandboxProviderStore,
  environment_version_id,
  logger,
}: {
  sandboxEnvironmentStore: ISandboxEnvironmentStore;
  sandboxProviderStore: ISandboxProviderStore;
  environment_version_id: string;
  logger: Logger;
}): Promise<'ok' | 'not_found'> {
  const pending = await sandboxEnvironmentStore.getVersionForProgress({ environment_version_id });
  if (pending === undefined) {
    return 'not_found';
  }

  const providerRecord = await sandboxProviderStore.getSandboxProvider(pending.tenant_id);
  if (providerRecord?.manifest.type !== 'daytona') {
    await sandboxEnvironmentStore.markVersionFailed({
      environment_version_id,
      status_reason: 'Sandbox environment build requires a Daytona sandbox provider',
    });
    return 'ok';
  }

  const provider = toDaytonaSandboxProvider({
    manifest: providerRecord.manifest,
    tenant_id: pending.tenant_id,
    logger,
    // Pin snapshot name to this version; platform image when env image is omitted.
    build_metadata: { build_ref: pending.external_ref },
    environment: pending.manifest,
  });

  try {
    // get → create-on-missing → map state (same path as former provider PUT build).
    const built = toSandboxStatus(await provider.buildImage());
    if (built.status === 'ready') {
      await sandboxEnvironmentStore.markVersionActive({ environment_version_id });
      return 'ok';
    }
    if (built.status === 'failed') {
      await sandboxEnvironmentStore.markVersionFailed({
        environment_version_id,
        status_reason: built.status_reason ?? 'Sandbox environment snapshot build failed',
      });
      return 'ok';
    }
    // pending / building — leave as pending for the next tick.
    return 'ok';
  } catch (error) {
    if (isDaytonaAuthError(error) || isDaytonaPermissionError(error)) {
      const status_reason = isDaytonaAuthError(error)
        ? 'Daytona rejected the API key — check the credentials'
        : 'Daytona denied access: the API key is missing required permissions';
      await sandboxEnvironmentStore.markVersionFailed({ environment_version_id, status_reason });
      logger.warn('Sandbox environment build failed authz', {
        environment_version_id,
        status_reason,
      });
      return 'ok';
    }
    throw error;
  }
}
