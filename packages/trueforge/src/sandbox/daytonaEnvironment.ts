/**
 * Turn-time Daytona sandbox-environment resolution: manifest → create overrides.
 */
import type { Resources } from '@daytona/sdk';
import type { DaytonaSandboxCreateParams, SandboxCreateOptions } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { SandboxProviderRecord } from '../db/sandboxProviderStore';
import type { DaytonaSandboxEnvironmentManifest } from '../schemas/sandboxEnvironment';

function mapResources(resources: NonNullable<DaytonaSandboxEnvironmentManifest['resources']>): Resources {
  return {
    ...(resources.cpu ? { cpu: resources.cpu } : {}),
    ...(resources.memory ? { memory: resources.memory } : {}),
    ...(resources.disk ? { disk: resources.disk } : {}),
    ...(resources.gpu != null ? { gpu: resources.gpu } : {}),
    ...(resources.gpu_type ? { gpuType: resources.gpu_type } : {}),
  };
}

/**
 * Maps a Daytona sandbox-environment manifest onto Daytona create overrides.
 * `trueforge-default` uses the tenant provider snapshot (`buildRef`).
 */
export function mapDaytonaEnvironmentToCreateParams({
  manifest,
  buildRef,
}: {
  manifest: DaytonaSandboxEnvironmentManifest;
  buildRef: string;
}): DaytonaSandboxCreateParams {
  const image =
    manifest.image.type === 'trueforge-default'
      ? { snapshot: buildRef }
      : manifest.image.type === 'snapshot'
        ? { snapshot: manifest.image.name }
        : { image: manifest.image.ref };

  return {
    ...image,
    ...(manifest.resources ? { resources: mapResources(manifest.resources) } : {}),
    ...(manifest.secrets ? { secrets: manifest.secrets } : {}),
    ...(manifest.networking?.network_block_all != null
      ? { networkBlockAll: manifest.networking.network_block_all }
      : {}),
    ...(manifest.networking?.network_allow_list ? { networkAllowList: manifest.networking.network_allow_list } : {}),
    ...(manifest.networking?.domain_allow_list ? { domainAllowList: manifest.networking.domain_allow_list } : {}),
    ...(manifest.networking?.outbound_proxy_url ? { outboundProxyUrl: manifest.networking.outbound_proxy_url } : {}),
    ...(manifest.lifecycle?.auto_stop_interval_in_minutes != null
      ? { autoStopInterval: manifest.lifecycle.auto_stop_interval_in_minutes }
      : {}),
    ...(manifest.lifecycle?.auto_archive_interval_in_minutes != null
      ? { autoArchiveInterval: manifest.lifecycle.auto_archive_interval_in_minutes }
      : {}),
    ...(manifest.lifecycle?.auto_delete_interval_in_minutes != null
      ? { autoDeleteInterval: manifest.lifecycle.auto_delete_interval_in_minutes }
      : {}),
  };
}

/**
 * Resolves a caller-owned sandbox environment for turn create overrides.
 * Returns undefined when the agent does not reference an environment.
 */
export async function resolveSandboxEnvironmentForTurn({
  tenant_id,
  subject_id,
  environmentName,
  providerRecord,
  sandboxEnvironmentStore,
}: {
  tenant_id: string;
  subject_id: string;
  environmentName: string | undefined;
  providerRecord: SandboxProviderRecord | undefined;
  sandboxEnvironmentStore: ISandboxEnvironmentStore;
}): Promise<
  | {
      environmentName: string;
      createOptions: SandboxCreateOptions;
      /** True when create clones the tenant release snapshot (`trueforge-default`). */
      requiresTenantSnapshot: boolean;
    }
  | undefined
> {
  if (!environmentName) {
    return undefined;
  }
  if (providerRecord?.manifest.type !== 'daytona') {
    throw new HTTPException(422, {
      message: 'sandbox.environment requires a configured Daytona sandbox provider',
    });
  }

  const environment = await sandboxEnvironmentStore.getSandboxEnvironment({
    tenant_id,
    name: environmentName,
  });
  if (environment?.created_by_subject.subject_id !== subject_id) {
    throw new HTTPException(422, {
      message: `Unknown sandbox environment "${environmentName}" — not found or not owned by the caller`,
    });
  }
  if (environment.manifest.provider !== providerRecord.name) {
    throw new HTTPException(422, {
      message: `Sandbox environment "${environmentName}" provider does not match the configured sandbox provider`,
    });
  }

  const buildRef = providerRecord.build_metadata?.['build_ref'];
  const requiresTenantSnapshot = environment.manifest.image.type === 'trueforge-default';
  if (requiresTenantSnapshot && !buildRef) {
    throw new HTTPException(422, {
      message: 'trueforge-default image requires a ready sandbox provider build_ref',
    });
  }

  return {
    environmentName,
    createOptions: {
      daytona: mapDaytonaEnvironmentToCreateParams({
        manifest: environment.manifest,
        buildRef: buildRef ?? '',
      }),
    },
    requiresTenantSnapshot,
  };
}
