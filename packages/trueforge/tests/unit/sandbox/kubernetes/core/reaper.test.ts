import { createLogger } from 'winston';
import type { SandboxBackend } from '../../../../../src/sandbox/kubernetes/backend/SandboxBackend';
import { KubernetesSandboxReaper } from '../../../../../src/sandbox/kubernetes/core/reaper';

function fakeBackend(entries: Array<{ name: string; createdAt: Date; tenantId?: string }>): {
  backend: SandboxBackend;
  deleted: string[];
} {
  const deleted: string[] = [];
  const backend: SandboxBackend = {
    kind: 'pod',
    create: async () => undefined,
    waitUntilRunning: async () => {
      throw new Error('unused');
    },
    getRunningPod: async () => {
      throw new Error('unused');
    },
    delete: async ({ name }) => {
      deleted.push(name);
    },
    list: async () => entries,
  };
  return { backend, deleted };
}

describe('KubernetesSandboxReaper', () => {
  it('deletes only stale resources owned by the current tenant', async () => {
    const { backend, deleted } = fakeBackend([
      { name: 'old-owned', createdAt: new Date('2026-01-01T00:00:00Z'), tenantId: 'acme' },
      { name: 'old-other', createdAt: new Date('2026-01-01T00:00:00Z'), tenantId: 'other' },
      { name: 'new-owned', createdAt: new Date('2026-02-08T00:00:00Z'), tenantId: 'acme' },
    ]);
    const reaper = new KubernetesSandboxReaper({
      backend,
      tenantId: 'acme',
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      logger: createLogger({ silent: true }),
    });

    await expect(reaper.reap(Date.parse('2026-02-10T00:00:00Z'))).resolves.toBe(1);
    expect(deleted).toEqual(['old-owned']);
  });

  it('does nothing when the TTL is disabled', async () => {
    const { backend, deleted } = fakeBackend([
      { name: 'old-owned', createdAt: new Date('2026-01-01T00:00:00Z'), tenantId: 'acme' },
    ]);
    const reaper = new KubernetesSandboxReaper({
      backend,
      tenantId: 'acme',
      ttlMs: 0,
      logger: createLogger({ silent: true }),
    });

    await expect(reaper.reap(Date.now())).resolves.toBe(0);
    expect(deleted).toEqual([]);
  });
});
