import type { SaveAgentResult } from '@/index.js';
import type { CatalogServer } from '@/server/types.js';
import { describe, expect, it, vi } from 'vitest';

import { createTrueFoundryServer } from '@/server/createTrueFoundryServer.js';
import { createMockAgentUIServer } from './mockServer.js';

describe('createTrueFoundryServer', () => {
  it('composes chat server with builder callbacks', async () => {
    const chatServer = createMockAgentUIServer({
      createSession: vi.fn(),
      listSessions: vi.fn(),
      getSession: vi.fn(),
      updateSession: vi.fn(),
      createTurn: vi.fn(),
      cancelSession: vi.fn(),
      listTurns: vi.fn(),
      getTurn: vi.fn(),
      listEvents: vi.fn(),
    });

    const capabilities = {
      data: { sandbox: { enabled: true }, skill: { enabled: true } },
    };
    const getCapabilities = vi.fn(async () => capabilities);
    const getModels = vi.fn(async () => [
      {
        id: 'm',
        name: 'p/m',
        provider: { name: 'p' },
        properties: {},
      },
    ]);
    const getSkills = vi.fn(async () => []);
    const getMcp = vi.fn(async () => []);
    const getMcpTools = vi.fn(async () => [{ id: 'search', name: 'search', description: 'Search repositories' }]);
    const searchAgents = vi.fn(async () => [{ name: 'ask-ai-agent', agentId: 'ask-ai-agent' }]);
    const saveAgent = vi.fn(async (): Promise<SaveAgentResult> => ({ agentId: 'agent-1' }));
    const sessions = {
      getAgent: vi.fn(),
      getCodeSnippets: vi.fn(),
      listSessions: vi.fn(async () => ({ data: [] })),
      listSessionEvents: vi.fn(async () => ({ data: [] })),
    };

    const server = createTrueFoundryServer({
      chatServer,
      getCapabilities,
      getModels,
      getSkills,
      getMcp,
      getMcpTools,
      searchAgents,
      saveAgent,
      sessions,
    });

    expect(server.createSession).toBe(chatServer.createSession);
    expect(server.listSessions).toBe(chatServer.listSessions);
    expect(server.catalog).toBeUndefined();
    expect(server.sessions).toBe(sessions);

    await expect(server.getCapabilities()).resolves.toEqual(capabilities);
    await expect(server.getModels()).resolves.toHaveLength(1);
    await expect(server.getMcpTools?.({ connectorId: 'github' })).resolves.toEqual([
      { id: 'search', name: 'search', description: 'Search repositories' },
    ]);
    expect(getMcpTools).toHaveBeenCalledWith({ connectorId: 'github' });
    await expect(server.searchAgents({ query: 'ask' })).resolves.toEqual([
      { name: 'ask-ai-agent', agentId: 'ask-ai-agent' },
    ]);
    expect(searchAgents).toHaveBeenCalledWith({ query: 'ask' });

    await server.saveAgent({
      agentName: 'my-agent',
      agentSpec: { model: { name: 'p/m' } },
      intent: 'create',
    });
    expect(saveAgent).toHaveBeenCalled();
  });

  it('attaches optional catalog when provided', async () => {
    const chatServer = createMockAgentUIServer({
      createSession: vi.fn(),
      listSessions: vi.fn(),
      getSession: vi.fn(),
      updateSession: vi.fn(),
      createTurn: vi.fn(),
      cancelSession: vi.fn(),
      listTurns: vi.fn(),
      getTurn: vi.fn(),
      listEvents: vi.fn(),
    });

    const catalog: CatalogServer = {
      modelCatalog: {
        getModelProviderCatalog: vi.fn(async () => []),
        listModelProviders: vi.fn(async () => [{ id: 'openai', type: 'openai', name: 'OpenAI', models: [] }]),
        createModelProvider: vi.fn(async req => ({
          id: 'openai',
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

    const server = createTrueFoundryServer({
      chatServer,
      getCapabilities: async () => ({
        data: { sandbox: { enabled: false }, skill: { enabled: false } },
      }),
      getModels: async () => [],
      getSkills: async () => [],
      getMcp: async () => [],
      searchAgents: async () => [],
      saveAgent: async () => ({ agentId: 'agent-1' }),
      catalog,
    });

    expect(server.catalog).toBe(catalog);
    if (server.catalog === undefined) {
      throw new Error('Expected catalog');
    }
    await expect(server.catalog.modelCatalog.listModelProviders()).resolves.toEqual([
      { id: 'openai', type: 'openai', name: 'OpenAI', models: [] },
    ]);
  });
});
