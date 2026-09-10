'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

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
  const [requestEpoch, setRequestEpoch] = useState<number | null>(null);
  const [models, setModels] = useState<ModelSelection[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [connectors, setConnectors] = useState<ConnectorState[]>([]);
  const [connectorLogos, setConnectorLogos] = useState<Record<string, string>>(EMPTY_LOGOS);
  const [completedEpoch, setCompletedEpoch] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ensureLoaded = useCallback(() => {
    setRequestEpoch(current => current ?? 0);
  }, []);

  const refresh = useCallback(() => {
    setRequestEpoch(current => (current ?? -1) + 1);
  }, []);

  const refreshConnectors = useCallback(async () => {
    if (!server) return;
    setLoading(true);
    setError(null);
    try {
      setConnectors(await server.getMcp());
    } catch (reason: unknown) {
      setError(getErrorMessage(reason, 'Failed to load connectors.'));
    } finally {
      setLoading(false);
    }
  }, [server]);

  useEffect(() => {
    if (requestEpoch === null || !server) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Settle each list alone so one failing picker does not blank the others.
    // Logos are cosmetic: a missing catalog port or a failed fetch just falls back to icons.
    const connectorCatalog = server.catalog?.connectorCatalog;
    void Promise.allSettled([
      server.getModels(),
      server.getSkills(),
      server.getMcp(),
      connectorCatalog ? connectorCatalog.getConnectorCatalog() : Promise.resolve([]),
    ]).then(([modelsResult, skillsResult, mcpResult, catalogResult]) => {
      if (cancelled) return;
      setConnectorLogos(catalogResult.status === 'fulfilled' ? toConnectorLogos(catalogResult.value) : EMPTY_LOGOS);
      const errors: string[] = [];
      if (modelsResult.status === 'fulfilled') {
        setModels(modelsResult.value);
      } else {
        errors.push(getErrorMessage(modelsResult.reason, 'Failed to load models.'));
      }
      if (skillsResult.status === 'fulfilled') {
        setSkills(skillsResult.value);
      } else {
        errors.push(getErrorMessage(skillsResult.reason, 'Failed to load skills.'));
      }
      if (mcpResult.status === 'fulfilled') {
        setConnectors(mcpResult.value);
      } else {
        errors.push(getErrorMessage(mcpResult.reason, 'Failed to load connectors.'));
      }
      setError(errors[0] ?? null);
      setCompletedEpoch(requestEpoch);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [requestEpoch, server]);

  const loaded = requestEpoch !== null && completedEpoch === requestEpoch;
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
