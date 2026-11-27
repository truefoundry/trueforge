'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { useServerQueryClient } from '../../server/queryClient.js';
import { queryKeys } from '../../server/queryKeys.js';
import { useOptionalSandboxEnvironmentServer } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { ListSandboxEnvironmentsParams, SandboxEnvironment } from '../../server/types.js';
import { drainListPages } from '../../utils/drainListPages.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';

/** Full catalog for pickers. The manage page uses its own paged key. */
const ALL_ENVIRONMENTS_PARAMS = { limit: 1000 } satisfies ListSandboxEnvironmentsParams;

export type UseSandboxEnvironmentsResult = {
  /** Every environment, including ones that cannot be picked yet; see `environmentUnavailableReason`. */
  environments: SandboxEnvironment[];
  /** The environment carrying the tenant default flag, whatever its build status. */
  defaultEnvironment: SandboxEnvironment | undefined;
  loading: boolean;
  /** True once a list request has finished successfully, so an empty list is authoritative. */
  loaded: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

/**
 * Loads the tenant's sandbox environments for the pickers. Building, failed, and disabled ones
 * are kept in the list so they can be shown greyed out with a reason rather than vanishing.
 *
 * One query is shared by every mounted picker. Manage CRUD invalidates it through
 * `invalidateEnvironmentsList`. Closing the Manage Environments overlay refetches so a
 * still-mounted picker picks up edits without remounting.
 */
export function useSandboxEnvironments(): UseSandboxEnvironmentsResult {
  const environmentServer = useOptionalSandboxEnvironmentServer();
  const queryClient = useServerQueryClient();
  const shell = useOptionalShellMode();
  const environmentsOpen = shell?.environmentsOpen ?? false;
  const wasEnvironmentsOpenRef = useRef(environmentsOpen);

  const query = useQuery(
    {
      queryKey: queryKeys.environments.allPages(ALL_ENVIRONMENTS_PARAMS),
      queryFn: async (): Promise<SandboxEnvironment[]> => {
        if (environmentServer == null) {
          throw new Error('sandbox environment server missing');
        }
        return drainListPages({
          fetchPage: pageToken => environmentServer.listEnvironments({ limit: 1000, pageToken }),
        });
      },
      enabled: environmentServer != null,
    },
    queryClient,
  );
  const { refetch: refetchQuery } = query;

  const refetch = useCallback(async () => {
    if (environmentServer == null) return;
    await refetchQuery();
  }, [environmentServer, refetchQuery]);

  // The manage overlay writes through its own paged query, so pickers that stayed mounted
  // would keep the catalog from before the overlay opened.
  useEffect(() => {
    if (wasEnvironmentsOpenRef.current && !environmentsOpen) {
      void refetch();
    }
    wasEnvironmentsOpenRef.current = environmentsOpen;
  }, [environmentsOpen, refetch]);

  const environments = query.data ?? [];
  const error = query.error != null ? getErrorMessage(query.error, 'Failed to load sandbox environments.') : null;

  return {
    environments,
    defaultEnvironment: environments.find(env => env.isDefault),
    loading: query.isLoading,
    loaded: query.isSuccess,
    error,
    refetch,
  };
}
