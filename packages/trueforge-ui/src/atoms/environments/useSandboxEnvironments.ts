'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useOptionalSandboxEnvironmentServer } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { SandboxEnvironment } from '../../server/types.js';
import { drainListPages } from '../../utils/drainListPages.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';

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
 * Re-fetches when the shell environments catalog epoch bumps (after manage CRUD /
 * activation) and when the Manage Environments overlay closes, so still-mounted
 * agent pickers stay in sync without remounting.
 */
export function useSandboxEnvironments(): UseSandboxEnvironmentsResult {
  const environmentServer = useOptionalSandboxEnvironmentServer();
  const shell = useOptionalShellMode();
  const environmentsListEpoch = shell?.environmentsListEpoch ?? 0;
  const environmentsOpen = shell?.environmentsOpen ?? false;
  const [environments, setEnvironments] = useState<SandboxEnvironment[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenRef = useRef(0);
  const wasEnvironmentsOpenRef = useRef(environmentsOpen);

  const fetchEnvironments = useCallback(async () => {
    if (!environmentServer) {
      setEnvironments([]);
      setLoaded(false);
      setLoading(false);
      setError(null);
      return;
    }

    const gen = ++requestGenRef.current;
    setLoading(true);
    setError(null);

    try {
      const all = await drainListPages({
        fetchPage: pageToken => environmentServer.listEnvironments({ limit: 1000, pageToken }),
      });
      if (gen !== requestGenRef.current) return;
      setEnvironments(all);
      setLoaded(true);
    } catch (caught) {
      if (gen !== requestGenRef.current) return;
      setError(getErrorMessage(caught, 'Failed to load sandbox environments.'));
      setEnvironments([]);
    } finally {
      if (gen === requestGenRef.current) {
        setLoading(false);
      }
    }
  }, [environmentServer]);

  useEffect(() => {
    void fetchEnvironments();
  }, [fetchEnvironments, environmentsListEpoch]);

  useEffect(() => {
    if (wasEnvironmentsOpenRef.current && !environmentsOpen) {
      void fetchEnvironments();
    }
    wasEnvironmentsOpenRef.current = environmentsOpen;
  }, [environmentsOpen, fetchEnvironments]);

  return {
    environments,
    defaultEnvironment: environments.find(env => env.isDefault),
    loading,
    loaded,
    error,
    refetch: fetchEnvironments,
  };
}
