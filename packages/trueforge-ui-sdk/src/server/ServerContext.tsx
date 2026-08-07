'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import type { AgentBuilderCapabilitiesResponse, AgentUIServer, CatalogServer } from './types.js';

const ServerContext = createContext<AgentUIServer | null>(null);
const ServerCapabilitiesContext = createContext<AgentBuilderCapabilitiesResponse['data'] | null>(null);

export function ServerProvider({ server, children }: { server: AgentUIServer; children: ReactNode }) {
  const [capabilities, setCapabilities] = useState<AgentBuilderCapabilitiesResponse['data'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCapabilities(null);
    void server.getCapabilities().then(
      response => {
        if (!cancelled) setCapabilities(response.data);
      },
      () => {
        if (!cancelled) setCapabilities(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [server]);

  return (
    <ServerContext.Provider value={server}>
      <ServerCapabilitiesContext.Provider value={capabilities}>{children}</ServerCapabilitiesContext.Provider>
    </ServerContext.Provider>
  );
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

export function useServerCapabilities(): AgentBuilderCapabilitiesResponse['data'] | null {
  return useContext(ServerCapabilitiesContext);
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
