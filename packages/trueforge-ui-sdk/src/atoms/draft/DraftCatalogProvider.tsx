'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useOptionalServer } from '../../server/ServerContext.js';
import type { AgentSkill, AgentUIServer, ConnectorState, ModelSelection } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';

type DraftCatalogValue = {
  models: ModelSelection[];
  skills: AgentSkill[];
  connectors: ConnectorState[];
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
      const nextConnectors = await server.getMcp();
      setConnectors(nextConnectors);
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
    void Promise.allSettled([server.getModels(), server.getSkills(), server.getMcp()])
      .then(([modelsResult, skillsResult, mcpResult]) => {
        if (cancelled) return;
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
      })
      .finally(() => {
        if (!cancelled) {
          setCompletedEpoch(requestEpoch);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [requestEpoch, server]);

  const loaded = requestEpoch !== null && completedEpoch === requestEpoch;
  const value = useMemo(
    () => ({ server, models, skills, connectors, loaded, loading, error, ensureLoaded, refresh, refreshConnectors }),
    [server, models, skills, connectors, loaded, loading, error, ensureLoaded, refresh, refreshConnectors],
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
