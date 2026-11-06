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
  // True when a server is present so the mount effect does not need a sync setLoading(true).
  const [loading, setLoading] = useState(() => environmentServer != null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenRef = useRef(0);
  const wasEnvironmentsOpenRef = useRef(environmentsOpen);

  /** List request only — callers that need a loading flash set that before invoking. */
  const loadEnvironments = useCallback(async () => {
    if (!environmentServer) {
      setEnvironments([]);
      setLoaded(false);
      setLoading(false);
      setError(null);
      return;
    }

    const gen = ++requestGenRef.current;

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

  /** Event-driven refresh: mark loading, then load. */
  const refetch = useCallback(async () => {
    if (environmentServer) {
      setLoading(true);
      setError(null);
    }
    await loadEnvironments();
  }, [environmentServer, loadEnvironments]);

  // Mount + catalog epoch: loading is already true on first paint when a server exists; epoch
  // bumps refresh quietly so pickers keep current rows without an extra effect setState.
  useEffect(() => {
    void loadEnvironments();
  }, [loadEnvironments, environmentsListEpoch]);

  useEffect(() => {
    if (wasEnvironmentsOpenRef.current && !environmentsOpen) {
      void refetch();
    }
    wasEnvironmentsOpenRef.current = environmentsOpen;
  }, [environmentsOpen, refetch]);

  return {
    environments,
    defaultEnvironment: environments.find(env => env.isDefault),
    loading,
    loaded,
    error,
    refetch,
  };
}
