'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { AgentUIServer, CatalogServer } from './types.js';

const ServerContext = createContext<AgentUIServer | null>(null);

export function ServerProvider({ server, children }: { server: AgentUIServer; children: ReactNode }) {
  return <ServerContext.Provider value={server}>{children}</ServerContext.Provider>;
}

export function useServer(): AgentUIServer {
  const server = useContext(ServerContext);
  if (server == null) {
    throw new Error('useServer must be used within a ServerProvider.');
  }
  return server;
}

export function useOptionalServer(): AgentUIServer | null {
  return useContext(ServerContext);
}

export function useCatalogServer(): CatalogServer {
  const server = useServer();
  if (server.catalog == null) {
    throw new Error('useCatalogServer requires AgentUIServer.catalog. Pass catalog to createTrueFoundryServer.');
  }
  return server.catalog;
}

export function useOptionalCatalogServer(): CatalogServer | null {
  return useOptionalServer()?.catalog ?? null;
}
