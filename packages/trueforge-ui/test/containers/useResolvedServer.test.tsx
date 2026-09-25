// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useResolvedServer } from '@/containers/useResolvedServer.js';
import type { ListPermissionsResponse, PermissionsServer } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../server/mockServer.js';

const permissions: PermissionsServer = {
  listPermissions: vi.fn(async (): Promise<ListPermissionsResponse> => ({
    data: { type: 'agent', permissions: {} },
  })),
};
const defaultHarnessPermissions: PermissionsServer = {
  listPermissions: vi.fn(async (): Promise<ListPermissionsResponse> => ({
    data: { type: 'agent', permissions: {} },
  })),
};

const mockCreateTrueForgeAgentUIServer = vi.fn((options?: { permissions?: PermissionsServer }) =>
  Promise.resolve(
    createMockAgentUIServer({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: true },
          skill: { enabled: true },
          settings: { enabled: true },
        },
      }),
      permissions: options?.permissions ?? defaultHarnessPermissions,
    }),
  ),
);

vi.mock('@/plugins/trueforge-agent-server-adapter/index.js', () => ({
  createTrueForgeAgentUIServer: (options?: Parameters<typeof mockCreateTrueForgeAgentUIServer>[0]) =>
    mockCreateTrueForgeAgentUIServer(options),
}));

describe('useResolvedServer', () => {
  it('passes through AgentUIServer synchronously', () => {
    const server = createMockAgentUIServer({ saveAgent: vi.fn() });
    const { result } = renderHook(() => useResolvedServer(server));
    expect(result.current).toEqual({
      status: 'ready',
      server,
      error: null,
    });
  });

  it('loads trueforge via createTrueForgeAgentUIServer', async () => {
    mockCreateTrueForgeAgentUIServer.mockClear();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useResolvedServer({
        type: 'trueforge',
        baseUrl: 'https://harness.example',
        token: 'tok',
        fetch: fetchImpl,
      }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(mockCreateTrueForgeAgentUIServer).toHaveBeenCalledWith({
      baseUrl: 'https://harness.example',
      token: 'tok',
      fetch: fetchImpl,
    });
    expect(result.current.server?.permissions).toBe(defaultHarnessPermissions);
    expect(result.current.server?.getCapabilities).toEqual(expect.any(Function));
  });

  it('passes an explicit permissions port to the trueforge server', async () => {
    mockCreateTrueForgeAgentUIServer.mockClear();
    const { result } = renderHook(() =>
      useResolvedServer({
        type: 'trueforge',
        token: 'tok',
        permissions,
      }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(mockCreateTrueForgeAgentUIServer).toHaveBeenCalledWith({
      token: 'tok',
      permissions,
    });
    expect(result.current.server?.permissions).toBe(permissions);
  });

  it('attaches an optional catalog onto the trueforge server when factory returns one', async () => {
    const catalog = createMockCatalog();
    mockCreateTrueForgeAgentUIServer.mockImplementationOnce(async () =>
      createMockAgentUIServer({
        catalog,
        getCapabilities: async () => ({
          data: {
            sandbox: { enabled: true },
            skill: { enabled: true },
            settings: { enabled: true },
          },
        }),
      }),
    );
    const { result } = renderHook(() =>
      useResolvedServer({
        type: 'trueforge',
        token: 'tok',
        catalog,
      }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(mockCreateTrueForgeAgentUIServer).toHaveBeenCalledWith({
      token: 'tok',
      catalog,
    });
    expect(result.current.server?.catalog).toBe(catalog);
  });
});
