/**
 * Harness SandboxEnvironmentServer adapter — maps runtime DTOs to SDK wire.
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type {
  ListResult,
  ListSandboxEnvironmentsParams,
  SandboxEnvironment,
  SandboxEnvironmentManifest,
  SandboxEnvironmentServer,
} from '../../../server/types.js';
import { toListResult } from '../chatServer.js';

/** Default list environments page size. */
const DEFAULT_PAGE_LIMIT = 25;
/** Maximum allowed environments page size, matching backend route limit. */
const MAX_PAGE_LIMIT = 1000;

function toIsoInstant(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function toUiManifest(wire: TrueForgeApi.SandboxEnvironmentManifest): SandboxEnvironmentManifest {
  return {
    name: wire.name,
    ...(wire.description === undefined ? {} : { description: wire.description }),
    ...(wire.image === undefined
      ? {}
      : {
          image: {
            type: 'build',
            ...(wire.image.buildScript === undefined ? {} : { buildScript: wire.image.buildScript }),
          },
        }),
    ...(wire.resources === undefined
      ? {}
      : {
          resources: {
            cpu: wire.resources.cpu ?? 1,
            memory: wire.resources.memory ?? 1,
            disk: wire.resources.disk ?? 3,
          },
        }),
    ...(wire.environmentVariables === undefined ? {} : { environmentVariables: wire.environmentVariables }),
    ...(wire.networking === undefined
      ? {}
      : {
          networking: {
            ...(wire.networking.networkBlockAll === undefined
              ? {}
              : { networkBlockAll: wire.networking.networkBlockAll }),
            ...(wire.networking.domainAllowList === undefined
              ? {}
              : { domainAllowList: wire.networking.domainAllowList }),
            ...(wire.networking.secrets === undefined
              ? {}
              : {
                  secrets: wire.networking.secrets.map(secret => ({
                    env: secret.env,
                    value: secret.value,
                    hosts: secret.hosts,
                  })),
                }),
          },
        }),
  };
}

function toWireManifest(manifest: SandboxEnvironmentManifest): TrueForgeApi.SandboxEnvironmentManifest {
  return {
    name: manifest.name,
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    ...(manifest.image === undefined
      ? {}
      : {
          image: {
            type: 'build',
            ...(manifest.image.buildScript === undefined ? {} : { buildScript: manifest.image.buildScript }),
          },
        }),
    ...(manifest.resources === undefined
      ? {}
      : {
          resources: {
            cpu: manifest.resources.cpu,
            memory: manifest.resources.memory,
            disk: manifest.resources.disk,
          },
        }),
    ...(manifest.environmentVariables === undefined ? {} : { environmentVariables: manifest.environmentVariables }),
    ...(manifest.networking === undefined
      ? {}
      : {
          networking: {
            ...(manifest.networking.networkBlockAll === undefined
              ? {}
              : { networkBlockAll: manifest.networking.networkBlockAll }),
            ...(manifest.networking.domainAllowList === undefined
              ? {}
              : { domainAllowList: manifest.networking.domainAllowList }),
            ...(manifest.networking.secrets === undefined
              ? {}
              : {
                  secrets: manifest.networking.secrets.map(secret => ({
                    env: secret.env,
                    value: secret.value,
                    hosts: secret.hosts,
                  })),
                }),
          },
        }),
  };
}

function toUiEnvironment(wire: TrueForgeApi.SandboxEnvironment): SandboxEnvironment {
  return {
    id: wire.id,
    name: wire.name,
    description: wire.description,
    status: wire.status,
    statusReason: wire.statusReason,
    manifest: toUiManifest(wire.manifest),
    createdBySubject: wire.createdBySubject,
    createdAt: toIsoInstant(wire.createdAt),
    updatedAt: toIsoInstant(wire.updatedAt),
  };
}

export function createSandboxEnvironmentServer(options: { client: TrueForge }): SandboxEnvironmentServer {
  const { client } = options;

  return {
    async listEnvironments(req?: ListSandboxEnvironmentsParams): Promise<ListResult<SandboxEnvironment>> {
      const limit = Math.min(Math.max(req?.limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
      const page = await client.sandboxEnvironments.list({
        limit,
        ...(req?.pageToken === undefined || req.pageToken === '' ? {} : { pageToken: req.pageToken }),
      });
      return toListResult(page, toUiEnvironment);
    },

    async getEnvironment({ name }): Promise<SandboxEnvironment> {
      const { data } = await client.sandboxEnvironments.get(name);
      return toUiEnvironment(data);
    },

    async createOrUpdateEnvironment({ manifest }): Promise<SandboxEnvironment> {
      const { data } = await client.sandboxEnvironments.createOrUpdate({
        manifest: toWireManifest(manifest),
      });
      return toUiEnvironment(data);
    },

    async deleteEnvironment({ name }): Promise<void> {
      await client.sandboxEnvironments.delete(name);
    },
  };
}
