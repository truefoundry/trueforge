import type { SandboxEnvironment, SandboxEnvironmentManifest, SandboxEnvironmentNetworking } from '../../server/types.js';

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
  const count = allowList.split(',').map(part => part.trim()).filter(part => part.length > 0).length;
  if (count === 0) return 'Unrestricted';
  return `${String(count)} allowed domain${count === 1 ? '' : 's'}`;
}

export function formatRelativeTime(iso: string | null, nowMs = Date.now()): string {
  if (iso == null) return '—';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const deltaSec = Math.round((nowMs - then) / 1000);
  if (deltaSec < 60) return 'just now';
  const mins = Math.round(deltaSec / 60);
  if (mins < 60) return `${String(mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${String(hours)} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${String(days)} day${days === 1 ? '' : 's'} ago`;
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
