import { hashKey, QueryClient, type DefaultOptions } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef } from 'react';

const DEFAULT_STALE_TIME_MS = 30_000;

/** Catalogs (models, skills, connectors, providers) change rarely and are invalidated by their own mutations. */
export const CATALOG_STALE_TIME_MS = 5 * 60_000;

/**
 * Reads refresh only when stale on mount or when a mutation invalidates them; focus,
 * reconnect, and automatic retries would add requests the UI does not need.
 */
function serverQueryDefaults(scope: number): DefaultOptions {
  return {
    queries: {
      staleTime: DEFAULT_STALE_TIME_MS,
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      // Hashing under the server scope keeps entries from a previous server unreachable.
      queryKeyHashFn: key => hashKey([scope, ...key]),
    },
  };
}

export function createServerQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: serverQueryDefaults(0) });
}

/** Points the client at a new server without remounting query observers bound to it. */
export function rescopeServerQueryClient({ queryClient, scope }: { queryClient: QueryClient; scope: number }): void {
  queryClient.setDefaultOptions(serverQueryDefaults(scope));
}

// Own context instead of QueryClientProvider so a host app's React Query client is never shadowed.
export const ServerQueryClientContext = createContext<QueryClient | null>(null);

/** QueryClientProvider is not used, so mount here; a mounted client resumes queries paused while offline. */
export function useMountServerQueryClient(queryClient: QueryClient | null): void {
  useEffect(() => {
    if (queryClient == null) return undefined;
    queryClient.mount();
    return () => queryClient.unmount();
  }, [queryClient]);
}

export function useServerQueryClient(): QueryClient {
  const provided = useContext(ServerQueryClientContext);
  const isolatedRef = useRef<QueryClient | null>(null);
  // Outside ServerProvider each consumer gets an isolated client, matching uncached behavior.
  const queryClient = provided ?? (isolatedRef.current ??= createServerQueryClient());
  useMountServerQueryClient(provided == null ? queryClient : null);
  return queryClient;
}
