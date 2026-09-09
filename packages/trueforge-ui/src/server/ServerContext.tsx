'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type {
  AgentBuilderCapabilitiesResponse,
  AgentMetricsServer,
  AgentSessionsServer,
  AgentUIServer,
  CatalogServer,
  ScheduleServer,
} from './types.js';

const ServerContext = createContext<AgentUIServer | null>(null);
const ServerCapabilitiesContext = createContext<{
  capabilities: AgentBuilderCapabilitiesResponse['data'] | null;
  refresh: () => void;
} | null>(null);

export function ServerProvider({ server, children }: { server: AgentUIServer; children: ReactNode }) {
  const [capabilities, setCapabilities] = useState<AgentBuilderCapabilitiesResponse['data'] | null>(null);
  const cancelActiveRequestRef = useRef<(() => void) | null>(null);
  const refreshCapabilities = useCallback(() => {
    cancelActiveRequestRef.current?.();
    let cancelled = false;
    cancelActiveRequestRef.current = () => {
      cancelled = true;
    };
    void server
      .getCapabilities()
      .then(response => {
        if (!cancelled) setCapabilities(response.data);
      })
      .catch(() => {
        // Preserve the last known capabilities when a refresh fails.
      });
  }, [server]);

  useEffect(() => {
    setCapabilities(null);
    refreshCapabilities();
    return () => {
      cancelActiveRequestRef.current?.();
    };
  }, [refreshCapabilities]);

  const capabilitiesValue = useMemo(
    () => ({ capabilities, refresh: refreshCapabilities }),
    [capabilities, refreshCapabilities],
  );

  return (
    <ServerContext.Provider value={server}>
      <ServerCapabilitiesContext.Provider value={capabilitiesValue}>{children}</ServerCapabilitiesContext.Provider>
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
  return useContext(ServerCapabilitiesContext)?.capabilities ?? null;
}

export function useOptionalRefreshServerCapabilities(): (() => void) | null {
  return useContext(ServerCapabilitiesContext)?.refresh ?? null;
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

export function useAgentSessionsServer(): AgentSessionsServer {
  const sessions = useServer().sessions;
  if (sessions == null) {
    throw new Error('useAgentSessionsServer requires AgentUIServer.sessions.');
  }
  return sessions;
}

export function useOptionalAgentSessionsServer(): AgentSessionsServer | null {
  return useOptionalServer()?.sessions ?? null;
}

export function useAgentMetricsServer(): AgentMetricsServer {
  const metrics = useServer().metrics;
  if (metrics == null) {
    throw new Error('useAgentMetricsServer requires AgentUIServer.metrics.');
  }
  return metrics;
}

export function useOptionalAgentMetricsServer(): AgentMetricsServer | null {
  return useOptionalServer()?.metrics ?? null;
}

export function useScheduleServer(): ScheduleServer {
  const server = useServer();
  if (server.schedules == null) {
    throw new Error('useScheduleServer requires AgentUIServer.schedules. Pass schedules to createTrueFoundryServer.');
  }
  return server.schedules;
}

export function useOptionalScheduleServer(): ScheduleServer | null {
  return useOptionalServer()?.schedules ?? null;
}
