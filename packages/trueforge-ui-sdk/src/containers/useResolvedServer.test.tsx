// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentUIServer } from '../server/types.js';
import { useResolvedServer } from './useResolvedServer.js';

vi.mock('@truefoundry/assistant-ui-runtime/plugins/truefoundry-agent-server-adapter', () => ({
  createTrueFoundryAgentUIServer: vi.fn(async () => ({
    createSession: vi.fn(),
    getModels: vi.fn(async () => []),
  })),
}));

function mockServer(): AgentUIServer {
  return { saveAgent: vi.fn() } as unknown as AgentUIServer;
}

describe('useResolvedServer', () => {
  it('passes through AgentUIServer synchronously', () => {
    const server = mockServer();
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
  });

  it('attaches an optional catalog onto the truefoundry server', async () => {
    const catalog = { skillCatalog: {} } as never;
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
  });
});
