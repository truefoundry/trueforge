// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ServerProvider, useCatalogServer, useOptionalCatalogServer } from './ServerContext.js';
import type { AgentUIServer, CatalogServer } from './types.js';

const catalog: CatalogServer = {
  modelCatalog: {
    getModelProviderCatalog: vi.fn(async () => []),
    listModelProviders: vi.fn(async () => []),
    createModelProvider: vi.fn(async req => ({
      id: 'p1',
      type: req.type,
      name: req.name,
      models: req.models,
    })),
    updateModelProvider: vi.fn(async req => ({
      id: req.id,
      type: req.type,
      name: req.name,
      models: req.models,
    })),
  },
  connectorCatalog: {
    getConnectorCatalog: vi.fn(async () => []),
    getConnector: vi.fn(async ({ id }) => ({
      id,
      name: '',
      description: '',
      url: '',
      auth: { type: 'none' as const },
      requiresAuth: false,
      authenticated: false,
    })),
    listConnectors: vi.fn(async () => []),
    getToolsByConnectorId: vi.fn(async () => []),
    createConnector: vi.fn(async req => ({
      id: 'c1',
      name: req.name,
      description: '',
      url: req.url,
      auth:
        req.auth.type === 'dcr'
          ? { type: 'dcr' as const, authUrl: 'https://example.com/oauth' }
          : req.auth.type === 'header'
            ? { type: 'header' as const }
            : { type: 'none' as const },
      requiresAuth: req.auth.type === 'dcr',
      authenticated: false,
    })),
    updateConnector: vi.fn(async req => ({
      id: req.id,
      name: req.name,
      description: '',
      url: req.url,
      auth:
        req.auth.type === 'dcr'
          ? { type: 'dcr' as const, authUrl: 'https://example.com/oauth' }
          : req.auth.type === 'header'
            ? { type: 'header' as const }
            : { type: 'none' as const },
      requiresAuth: req.auth.type === 'dcr',
      authenticated: false,
    })),
    authenticateConnector: vi.fn(async ({ id }) => ({
      id,
      name: '',
      description: '',
      url: '',
      auth: { type: 'dcr' as const, authUrl: 'https://example.com/oauth' },
      requiresAuth: false,
      authenticated: true,
    })),
    disconnectConnector: vi.fn(async ({ id }) => ({
      id,
      name: '',
      description: '',
      url: '',
      auth: { type: 'none' as const },
      requiresAuth: false,
      authenticated: false,
    })),
  },
};

function wrap(server: AgentUIServer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ServerProvider server={server}>{children}</ServerProvider>;
  };
}

describe('useCatalogServer', () => {
  it('returns server.catalog when present', () => {
    const server = { catalog } as unknown as AgentUIServer;
    const { result } = renderHook(() => useCatalogServer(), {
      wrapper: wrap(server),
    });
    expect(result.current).toBe(catalog);
  });

  it('throws when catalog is omitted', () => {
    const server = {} as unknown as AgentUIServer;
    expect(() => renderHook(() => useCatalogServer(), { wrapper: wrap(server) })).toThrow(
      /requires AgentUIServer\.catalog/,
    );
  });

  it('useOptionalCatalogServer returns null when omitted', () => {
    const server = {} as unknown as AgentUIServer;
    const { result } = renderHook(() => useOptionalCatalogServer(), {
      wrapper: wrap(server),
    });
    expect(result.current).toBeNull();
  });
});
