import { describe, expect, it, vi } from 'vitest';

import { createSandboxEnvironmentServer } from '@/plugins/trueforge-agent-server-adapter/sandboxEnvironments/sandboxEnvironmentServer.js';
import type { TrueForge } from '@truefoundry/trueforge-sdk';

const savedEnvResponse = {
  data: {
    id: 'e2',
    name: 'node-web',
    description: '',
    lifecycleStage: 'active' as const,
    status: 'pending' as const,
    statusReason: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    createdBySubject: {
      subjectId: 'user-1',
      subjectType: 'user' as const,
      subjectDisplayName: 'alice@example.com',
    },
    manifest: { name: 'node-web', resources: { cpu: 1, memory: 1, disk: 3 } },
  },
};

function mockClient(
  overrides: {
    list?: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
    createOrUpdate?: ReturnType<typeof vi.fn>;
    delete?: ReturnType<typeof vi.fn>;
  } = {},
): TrueForge {
  const list =
    overrides.list ??
    vi.fn(async () => ({
      data: [
        {
          id: 'e1',
          name: 'python-data',
          description: 'Python with httpx',
          lifecycleStage: 'active' as const,
          status: 'ready' as const,
          statusReason: null,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-02T00:00:00.000Z'),
          createdBySubject: {
            subjectId: 'user-1',
            subjectType: 'user',
            subjectDisplayName: 'alice@example.com',
          },
          manifest: {
            name: 'python-data',
            description: 'Python with httpx',
            resources: { cpu: 2, memory: 4, disk: 10 },
            networking: { networkBlockAll: false, domainAllowList: 'api.example.com' },
          },
        },
      ],
      response: { pagination: { limit: 25, nextPageToken: 'next-1' } },
      hasNextPage: () => true,
      getNextPage: async () => undefined,
    }));

  return {
    sandboxEnvironments: {
      list,
      get: vi.fn(),
      create: overrides.create ?? vi.fn(async () => savedEnvResponse),
      createOrUpdate: overrides.createOrUpdate ?? vi.fn(async () => savedEnvResponse),
      delete: overrides.delete ?? vi.fn(async () => ({})),
    },
  } as unknown as TrueForge;
}

describe('createSandboxEnvironmentServer', () => {
  it('lists environments with pagination tokens', async () => {
    const client = mockClient();
    const server = createSandboxEnvironmentServer({ client });
    const page = await server.listEnvironments({ limit: 10 });
    expect(client.sandboxEnvironments.list).toHaveBeenCalledWith({ limit: 10 });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.name).toBe('python-data');
    expect(page.data[0]?.manifest.resources?.cpu).toBe(2);
    expect(page.nextPageToken).toBe('next-1');

    await server.listEnvironments({ limit: 1000 });
    expect(client.sandboxEnvironments.list).toHaveBeenCalledWith({ limit: 1000 });
  });

  it('create, createOrUpdate, and delete call SDK methods', async () => {
    const create = vi.fn(async () => savedEnvResponse);
    const createOrUpdate = vi.fn(async () => savedEnvResponse);
    const del = vi.fn(async () => ({}));
    const client = mockClient({ create, createOrUpdate, delete: del });
    const server = createSandboxEnvironmentServer({ client });
    const created = await server.createEnvironment({
      manifest: { name: 'node-web', resources: { cpu: 1, memory: 1, disk: 3 } },
    });
    expect(created.name).toBe('node-web');
    expect(create).toHaveBeenCalledWith({
      manifest: { name: 'node-web', resources: { cpu: 1, memory: 1, disk: 3 } },
    });
    const saved = await server.createOrUpdateEnvironment({
      manifest: { name: 'node-web', resources: { cpu: 1, memory: 1, disk: 3 } },
    });
    expect(saved.name).toBe('node-web');
    expect(createOrUpdate).toHaveBeenCalledWith({
      manifest: { name: 'node-web', resources: { cpu: 1, memory: 1, disk: 3 } },
    });
    await server.deleteEnvironment({ name: 'node-web' });
    expect(del).toHaveBeenCalledWith('node-web');
  });
});
