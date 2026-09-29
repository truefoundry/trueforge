import type {
  SandboxEnvironment,
  SandboxEnvironmentManifest,
  SandboxEnvironmentNetworking,
} from '../../server/types.js';

export const RESERVED_ENVIRONMENT_NAME = 'default';

export function isReservedEnvironmentName(name: string): boolean {
  return name.trim() === RESERVED_ENVIRONMENT_NAME;
}

export function isEnvironmentReadOnly(env: Pick<SandboxEnvironment, 'name'>): boolean {
  return isReservedEnvironmentName(env.name);
}

export function formatResourcesSummary(resources: SandboxEnvironmentManifest['resources']): string {
  const cpu = resources?.cpu ?? 1;
  const memory = resources?.memory ?? 1;
  const disk = resources?.disk ?? 3;
  return `${String(cpu)} vCPU · ${String(memory)} GB RAM · ${String(disk)} GB disk`;
}

export function formatNetworkingSummary(networking: SandboxEnvironmentNetworking | undefined): string {
  if (networking?.networkBlockAll === true) return 'Blocked';
  const allowList = networking?.domainAllowList?.trim() ?? '';
  if (allowList.length === 0) return 'Unrestricted';
  const count = allowList
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0).length;
  if (count === 0) return 'Unrestricted';
  return `${String(count)} allowed domain${count === 1 ? '' : 's'}`;
}

export function defaultEnvironmentManifest(): SandboxEnvironmentManifest {
  return {
    name: '',
    description: '',
    image: { type: 'build', buildScript: '' },
    resources: { cpu: 1, memory: 1, disk: 3 },
    networking: { networkBlockAll: false },
  };
}
