// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useResolvedServer } from '@/containers/useResolvedServer.js';
import { createMockAgentUIServer, createMockCatalog } from '../server/mockServer.js';

vi.mock('@truefoundry/assistant-ui-runtime/plugins/truefoundry-agent-server-adapter', () => ({
  createTrueFoundryAgentUIServer: vi.fn(async () => ({
    createSession: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    updateSession: vi.fn(),
    createTurn: vi.fn(),
    cancelSession: vi.fn(),
    listTurns: vi.fn(),
    getTurn: vi.fn(),
    listEvents: vi.fn(),
    getModels: vi.fn(async () => []),
    getSkills: vi.fn(async () => []),
    getMcp: vi.fn(async () => []),
    searchAgents: vi.fn(async () => []),
    saveAgent: vi.fn(async () => ({})),
  })),
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

  it('errors for trueforge until the adapter exists', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useResolvedServer({ type: 'trueforge', apiKey: 'k' }, onError));

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(String(result.current.error)).toMatch(/not implemented/i);
    expect(onError).toHaveBeenCalled();
  });

  it('loads truefoundry via createTrueFoundryAgentUIServer', async () => {
    const { createTrueFoundryAgentUIServer } =
      await import('@truefoundry/assistant-ui-runtime/plugins/truefoundry-agent-server-adapter');
    const { result } = renderHook(() =>
      useResolvedServer({
        type: 'truefoundry',
        apiKey: 'k',
        controlPlaneURL: 'https://cp.example',
        gatewayPlaneURL: 'https://gw.example',
      }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(createTrueFoundryAgentUIServer).toHaveBeenCalledWith({
      apiKey: 'k',
      cpURL: 'https://cp.example',
      gatewayURL: 'https://gw.example',
    });
    expect(result.current.server?.getCapabilities).toEqual(expect.any(Function));
    await expect(result.current.server?.getCapabilities()).resolves.toEqual({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
        settings: { enabled: true },
      },
    });
  });

  it('attaches an optional catalog onto the truefoundry server', async () => {
    const catalog = createMockCatalog();
    const { result } = renderHook(() =>
      useResolvedServer({
        type: 'truefoundry',
        apiKey: 'k',
        controlPlaneURL: 'https://cp.example',
        catalog,
      }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.server?.catalog).toBe(catalog);
    expect(result.current.server?.getCapabilities).toEqual(expect.any(Function));
  });
});
