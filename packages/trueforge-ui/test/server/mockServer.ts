import type { AgentSessionsServer, AgentUIServer, CatalogServer } from '@/server/types.js';

async function unavailable(): Promise<never> {
  throw new Error('Unexpected mock server call');
}

async function* emptyTurnStream() {}

export function createMockCatalog(overrides: Partial<CatalogServer> = {}): CatalogServer {
  return {
    modelCatalog: {
      getModelProviderCatalog: async () => [],
      listModelProviders: async () => [],
      createModelProvider: unavailable,
      updateModelProvider: unavailable,
    },
    connectorCatalog: {
      getConnectorCatalog: async () => [],
      listConnectors: async () => [],
      getConnector: unavailable,
      getToolsByConnectorId: async () => [],
      createConnector: unavailable,
      updateConnector: unavailable,
      authenticateConnector: unavailable,
      disconnectConnector: unavailable,
    },
    ...overrides,
  };
}

export function createMockAgentSessionsServer(overrides: Partial<AgentSessionsServer> = {}): AgentSessionsServer {
  return {
    getAgent: unavailable,
    getCodeSnippets: async () => [],
    listSessions: async () => ({ data: [] }),
    listSessionEvents: async () => ({ data: [] }),
    ...overrides,
  };
}

export function createMockAgentUIServer(overrides: Partial<AgentUIServer> = {}): AgentUIServer {
  return {
    createSession: unavailable,
    listSessions: unavailable,
    getSession: unavailable,
    updateSession: unavailable,
    createTurn: emptyTurnStream,
    cancelSession: unavailable,
    listTurns: unavailable,
    getTurn: unavailable,
    listEvents: unavailable,
    getCapabilities: async () => ({
      data: { sandbox: { enabled: true }, skill: { enabled: true } },
    }),
    getModels: async () => [],
    getSkills: async () => [],
    getMcp: async () => [],
    searchAgents: async () => [],
    saveAgent: unavailable,
    ...overrides,
  };
}
