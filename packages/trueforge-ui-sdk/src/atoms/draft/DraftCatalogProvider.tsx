'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useOptionalServer } from '../../server/ServerContext.js';
import type { AgentSkill, ConnectorState, ModelSelection } from '../../server/types.js';

type DraftCatalogValue = {
  models: ModelSelection[];
  skills: AgentSkill[];
  connectors: ConnectorState[];
  loading: boolean;
  error: string | null;
};

const DraftCatalogContext = createContext<DraftCatalogValue | null>(null);

export function DraftCatalogProvider({ children }: { children: ReactNode }) {
  const server = useOptionalServer();
  const [models, setModels] = useState<ModelSelection[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [connectors, setConnectors] = useState<ConnectorState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([server.getModels(), server.getSkills(), server.getMcp()])
      .then(([nextModels, nextSkills, nextMcp]) => {
        if (cancelled) return;
        setModels(nextModels);
        setSkills(nextSkills);
        setConnectors(nextMcp);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load catalog.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [server]);

  const value = useMemo(
    () => ({ models, skills, connectors, loading, error }),
    [models, skills, connectors, loading, error],
  );

  return <DraftCatalogContext.Provider value={value}>{children}</DraftCatalogContext.Provider>;
}

export function useDraftCatalog(): DraftCatalogValue {
  const ctx = useContext(DraftCatalogContext);
  if (ctx == null) {
    return { models: [], skills: [], connectors: [], loading: false, error: null };
  }
  return ctx;
}
