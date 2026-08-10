'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useOptionalServer } from '../../server/ServerContext.js';
import type { AgentSkill, ConnectorState, ModelSelection } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';

type DraftCatalogValue = {
  models: ModelSelection[];
  skills: AgentSkill[];
  connectors: ConnectorState[];
  loading: boolean;
  error: string | null;
  /** Kick off catalog fetch (idempotent). Call when a picker opens. */
  ensureLoaded: () => void;
};

const DraftCatalogContext = createContext<DraftCatalogValue | null>(null);

const IDLE_ENSURE = () => undefined;

export function DraftCatalogProvider({ children }: { children: ReactNode }) {
  const server = useOptionalServer();
  const [requested, setRequested] = useState(false);
  const [models, setModels] = useState<ModelSelection[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [connectors, setConnectors] = useState<ConnectorState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ensureLoaded = useCallback(() => {
    setRequested(true);
  }, []);

  useEffect(() => {
    if (!requested || !server) return;
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
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requested, server]);

  const value = useMemo(
    () => ({ models, skills, connectors, loading, error, ensureLoaded }),
    [models, skills, connectors, loading, error, ensureLoaded],
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
      loading: false,
      error: null,
      ensureLoaded: IDLE_ENSURE,
    };
  }
  return ctx;
}
