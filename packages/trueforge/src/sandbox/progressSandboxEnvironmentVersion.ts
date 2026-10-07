/** Progress pending env version: snapshot build only (secrets sync on PUT). */
import { DAYTONA_SNAPSHOT_NOT_STARTED_REASON, withTimeout } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'winston';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import {
  DAYTONA_RPC_TIMEOUT_MS,
  getDaytonaAuthorizationErrorMessage,
  toDaytonaSandboxProvider,
  toSandboxEnvironment,
  toSandboxStatus,
} from '../sandbox/providerUtils';
import { captureCriticalException } from '../sentry';

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
}): Promise<void> {
  const pending = await sandboxEnvironmentStore.getSandboxEnvironmentVersion({ environment_version_id });
  if (pending === undefined) {
    const error = new HTTPException(404, { message: 'Sandbox environment version not found' });
    captureCriticalException(error, {
      tags: { module: 'progressSandboxEnvironmentVersion', operation: 'notFound' },
      extra: { environment_version_id },
    });
    throw error;
  }

  const providerRecord = await sandboxProviderStore.getSandboxProvider(pending.tenant_id);
  if (providerRecord === undefined) {
    throw new Error('Sandbox environment build requires a configured Daytona sandbox provider');
  }

  const provider = toDaytonaSandboxProvider({
    manifest: providerRecord.manifest,
    tenant_id: pending.tenant_id,
    logger,
  });
  const environment = toSandboxEnvironment({
    external_ref: pending.external_ref,
    manifest: pending.manifest,
  });

  try {
    const status = await withTimeout(
      provider.getBuildStatus(environment),
      DAYTONA_RPC_TIMEOUT_MS,
      'sandbox environment getBuildStatus',
    );
    const built = toSandboxStatus(
      status.reason === DAYTONA_SNAPSHOT_NOT_STARTED_REASON
        ? await withTimeout(provider.build(environment), DAYTONA_RPC_TIMEOUT_MS, 'sandbox environment build')
        : status,
    );
    if (built.status === 'ready') {
      await sandboxEnvironmentStore.markVersionReady({ environment_version_id });
    } else if (built.status === 'failed') {
      await sandboxEnvironmentStore.markVersionFailed({
        environment_version_id,
        status_reason: built.status_reason ?? 'Sandbox environment snapshot build failed',
      });
    }
    // pending / building — leave as pending for the next tick.
  } catch (error) {
    const status_reason = getDaytonaAuthorizationErrorMessage(error);
    if (status_reason !== undefined) {
      await sandboxEnvironmentStore.markVersionFailed({ environment_version_id, status_reason });
      logger.warn('Sandbox environment build failed authz', {
        environment_version_id,
        status_reason,
      });
      captureCriticalException(error, {
        tags: { module: 'progressSandboxEnvironmentVersion', operation: 'authz' },
        extra: { environment_version_id, tenant_id: pending.tenant_id, status_reason },
      });
      return;
    }
    captureCriticalException(error, {
      tags: { module: 'progressSandboxEnvironmentVersion', operation: 'build' },
      extra: { environment_version_id, tenant_id: pending.tenant_id },
    });
    throw error;
  }
}
