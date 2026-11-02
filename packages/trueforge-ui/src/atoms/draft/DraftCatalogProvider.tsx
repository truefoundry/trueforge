'use client';

import { useQueries } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { CATALOG_STALE_TIME_MS, useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useOptionalServer } from '../../server/ServerContext.js';
import type {
  AgentSkill,
  AgentUIServer,
  ConnectorCatalogEntry,
  ConnectorState,
  ModelSelection,
} from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';

type DraftCatalogValue = {
  models: ModelSelection[];
  skills: AgentSkill[];
  connectors: ConnectorState[];
  /** Connector logo URL keyed by connector name, sourced from the discovery catalog. */
  connectorLogos: Record<string, string>;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** Kick off catalog fetch (idempotent). Call when a picker opens. */
  ensureLoaded: () => void;
  /** Reload all collections after settings mutate catalog-backed configuration. */
  refresh: () => void;
  /** Refresh connector auth state without reloading unrelated catalogs. */
  refreshConnectors: () => Promise<void>;
};

type DraftCatalogContextValue = DraftCatalogValue & {
  server: AgentUIServer | null;
};

const DraftCatalogContext = createContext<DraftCatalogContextValue | null>(null);

const IDLE_ENSURE = () => undefined;
const IDLE_REFRESH = async () => undefined;
const EMPTY_LOGOS: Record<string, string> = {};

const EMPTY_MODELS: ModelSelection[] = [];
const EMPTY_SKILLS: AgentSkill[] = [];
const EMPTY_CONNECTORS: ConnectorState[] = [];

function requireServer(server: AgentUIServer | null): AgentUIServer {
  if (server == null) throw new Error('Catalog requires a server.');
  return server;
}

function catalogError(entries: { error: Error | null; fallback: string }[]): string | null {
  const failed = entries.find(entry => entry.error != null);
  return failed == null ? null : getErrorMessage(failed.error, failed.fallback);
}

function toConnectorLogos(entries: ConnectorCatalogEntry[]): Record<string, string> {
  const logos: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.logo) logos[entry.name] = entry.logo;
  }
  return logos;
}

export function DraftCatalogProvider({ children }: { children: ReactNode }) {
  const server = useOptionalServer();
  const existing = useContext(DraftCatalogContext);
  if (existing?.server === server) {
    return children;
  }
  return <DraftCatalogStore server={server}>{children}</DraftCatalogStore>;
}

function DraftCatalogStore({ server, children }: { server: AgentUIServer | null; children: ReactNode }) {
  const queryClient = useServerQueryClient();
  // Pickers fetch on first open, not on mount.
  const [requested, setRequested] = useState(false);
  const enabled = requested && server != null;
  const connectorCatalog = server?.catalog?.connectorCatalog;

  // Settle each list alone so one failing picker does not blank the others.
  const [modelsQuery, skillsQuery, mcpQuery, logosQuery] = useQueries(
    {
      queries: [
        {
          queryKey: queryKeys.catalog.models(),
          queryFn: () => requireServer(server).getModels(),
          enabled,
          staleTime: CATALOG_STALE_TIME_MS,
        },
        {
          queryKey: queryKeys.catalog.skills(),
          queryFn: () => requireServer(server).getSkills(),
          enabled,
          staleTime: CATALOG_STALE_TIME_MS,
        },
        {
          queryKey: queryKeys.catalog.mcp(),
          queryFn: () => requireServer(server).getMcp(),
          enabled,
          staleTime: CATALOG_STALE_TIME_MS,
        },
        {
          queryKey: queryKeys.catalog.connectorCatalog(),
          // Logos are cosmetic: a missing catalog port just falls back to icons.
          queryFn: () => (connectorCatalog ? connectorCatalog.getConnectorCatalog() : Promise.resolve([])),
          select: toConnectorLogos,
          enabled,
          staleTime: CATALOG_STALE_TIME_MS,
        },
      ],
    },
    queryClient,
  );

  const ensureLoaded = useCallback(() => {
    setRequested(true);
  }, []);

  const refresh = useCallback(() => {
    setRequested(true);
    void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.all() });
  }, [queryClient]);

  const refreshConnectors = useCallback(async () => {
    if (!server) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.mcpConnectors() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.mcpToolsAll() });
    try {
      await queryClient.fetchQuery({ queryKey: queryKeys.catalog.mcp(), queryFn: () => server.getMcp(), staleTime: 0 });
    } catch {
      // The failure is recorded on the query and surfaced through `error`.
    }
  }, [queryClient, server]);

  const models = modelsQuery.data ?? EMPTY_MODELS;
  const skills = skillsQuery.data ?? EMPTY_SKILLS;
  const connectors = mcpQuery.data ?? EMPTY_CONNECTORS;
  const connectorLogos = logosQuery.data ?? EMPTY_LOGOS;
  const listQueries = [modelsQuery, skillsQuery, mcpQuery];
  const loading = listQueries.some(query => query.isFetching);
  const loaded = enabled && !loading && listQueries.every(query => !query.isPending);
  const error = catalogError([
    { error: modelsQuery.error, fallback: 'Failed to load models.' },
    { error: skillsQuery.error, fallback: 'Failed to load skills.' },
    { error: mcpQuery.error, fallback: 'Failed to load connectors.' },
  ]);

  const value = useMemo(
    () => ({
      server,
      models,
      skills,
      connectors,
      connectorLogos,
      loaded,
      loading,
      error,
      ensureLoaded,
      refresh,
      refreshConnectors,
    }),
    [
      server,
      models,
      skills,
      connectors,
      connectorLogos,
      loaded,
      loading,
      error,
      ensureLoaded,
      refresh,
      refreshConnectors,
    ],
  );

  return <DraftCatalogContext.Provider value={value}>{children}</DraftCatalogContext.Provider>;
}

export function useDraftCatalog(): DraftCatalogValue {
  const ctx = useContext(DraftCatalogContext);
  if (ctx == null) {
    return {
      models: [],
      skills: [],
      connectors: [],
      connectorLogos: EMPTY_LOGOS,
      loaded: false,
      loading: false,
      error: null,
      ensureLoaded: IDLE_ENSURE,
      refresh: IDLE_ENSURE,
      refreshConnectors: IDLE_REFRESH,
    };
  }
  return ctx;
}
