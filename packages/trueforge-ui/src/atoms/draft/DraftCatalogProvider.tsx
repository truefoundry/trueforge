'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useOptionalServer } from '../../server/ServerContext.js';
import type { AgentSkill, AgentUIServer, ConnectorState, ListResult, ModelSelection } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';

/** Picker page size for MCP infinite scroll. */
export const MCP_CONNECTORS_PAGE_SIZE = 50;

type DraftCatalogValue = {
  models: ModelSelection[];
  skills: AgentSkill[];
  connectors: ConnectorState[];
  connectorsHasMore: boolean;
  connectorsLoadingMore: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** Kick off catalog fetch (idempotent). Call when a picker opens. */
  ensureLoaded: () => void;
  /** Reload all collections after settings mutate catalog-backed configuration. */
  refresh: () => void;
  /** Refresh connector auth state without reloading unrelated catalogs. */
  refreshConnectors: () => Promise<void>;
  /** Append the next MCP page when `connectorsHasMore`. */
  loadMoreConnectors: () => void;
};

type DraftCatalogContextValue = DraftCatalogValue & {
  server: AgentUIServer | null;
};

const DraftCatalogContext = createContext<DraftCatalogContextValue | null>(null);

const IDLE_ENSURE = () => undefined;
const IDLE_REFRESH = async () => undefined;

function appendConnectors({
  previous,
  next,
}: {
  previous: ConnectorState[];
  next: ConnectorState[];
}): ConnectorState[] {
  if (next.length === 0) return previous;
  const seen = new Set(previous.map(connector => connector.id));
  const appended = next.filter(connector => !seen.has(connector.id));
  return appended.length === 0 ? previous : [...previous, ...appended];
}

async function fetchMcpPage({
  server,
  pageToken,
}: {
  server: AgentUIServer;
  pageToken?: string;
}): Promise<ListResult<ConnectorState>> {
  if (server.listMcp != null) {
    return server.listMcp({
      limit: MCP_CONNECTORS_PAGE_SIZE,
      ...(pageToken === undefined ? {} : { pageToken }),
    });
  }
  const data = await server.getMcp();
  return { data };
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
  const [connectorsNextPageToken, setConnectorsNextPageToken] = useState<string | undefined>(undefined);
  const [connectorsLoadingMore, setConnectorsLoadingMore] = useState(false);
  const [completedEpoch, setCompletedEpoch] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectorsNextPageTokenRef = useRef(connectorsNextPageToken);
  const connectorsLoadingMoreRef = useRef(connectorsLoadingMore);
  const loadMoreFailedRef = useRef(false);
  connectorsNextPageTokenRef.current = connectorsNextPageToken;
  connectorsLoadingMoreRef.current = connectorsLoadingMore;

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
      const page = await fetchMcpPage({ server });
      setConnectors(page.data);
      setConnectorsNextPageToken(page.nextPageToken);
    } catch (reason: unknown) {
      setError(getErrorMessage(reason, 'Failed to load connectors.'));
    } finally {
      setLoading(false);
    }
  }, [server]);

  const loadMoreConnectors = useCallback(() => {
    if (!server) return;
    const pageToken = connectorsNextPageTokenRef.current;
    if (pageToken == null || pageToken.length === 0 || connectorsLoadingMoreRef.current) return;

    setConnectorsLoadingMore(true);
    void fetchMcpPage({ server, pageToken })
      .then(page => {
        setConnectors(previous => appendConnectors({ previous, next: page.data }));
        setConnectorsNextPageToken(page.nextPageToken);
        // Clear a stale load-more failure once a retry succeeds.
        if (loadMoreFailedRef.current) {
          loadMoreFailedRef.current = false;
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        loadMoreFailedRef.current = true;
        setError(getErrorMessage(reason, 'Failed to load more connectors.'));
      })
      .finally(() => {
        setConnectorsLoadingMore(false);
      });
  }, [server]);

  useEffect(() => {
    if (requestEpoch === null || !server) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Settle each list alone so one failing picker does not blank the others.
    void Promise.allSettled([server.getModels(), server.getSkills(), fetchMcpPage({ server })]).then(
      ([modelsResult, skillsResult, mcpResult]) => {
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
          setConnectors(mcpResult.value.data);
          setConnectorsNextPageToken(mcpResult.value.nextPageToken);
        } else {
          errors.push(getErrorMessage(mcpResult.reason, 'Failed to load connectors.'));
        }
        setError(errors[0] ?? null);
        setCompletedEpoch(requestEpoch);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [requestEpoch, server]);

  const connectorsHasMore = connectorsNextPageToken != null && connectorsNextPageToken.length > 0;
  const loaded = requestEpoch !== null && completedEpoch === requestEpoch;
  const value = useMemo(
    () => ({
      server,
      models,
      skills,
      connectors,
      connectorsHasMore,
      connectorsLoadingMore,
      loaded,
      loading,
      error,
      ensureLoaded,
      refresh,
      refreshConnectors,
      loadMoreConnectors,
    }),
    [
      server,
      models,
      skills,
      connectors,
      connectorsHasMore,
      connectorsLoadingMore,
      loaded,
      loading,
      error,
      ensureLoaded,
      refresh,
      refreshConnectors,
      loadMoreConnectors,
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
      connectorsHasMore: false,
      connectorsLoadingMore: false,
      loaded: false,
      loading: false,
      error: null,
      ensureLoaded: IDLE_ENSURE,
      refresh: IDLE_ENSURE,
      refreshConnectors: IDLE_REFRESH,
      loadMoreConnectors: IDLE_ENSURE,
    };
  }
  return ctx;
}
