'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useOptionalSandboxEnvironmentServer } from '../../server/ServerContext.js';
import { useOptionalShellMode } from '../../server/ShellModeContext.js';
import type { SandboxEnvironment } from '../../server/types.js';
import { drainListPages } from '../../utils/drainListPages.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';

export type UseReadySandboxEnvironmentsResult = {
  environments: SandboxEnvironment[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

/**
 * Loads sandbox environments and filters strictly to ready (`status === 'ready'`) records.
 * Environments still building (`pending`) or failed (`failed`) are excluded.
 *
 * Re-fetches when the shell environments catalog epoch bumps (after manage CRUD /
 * activation) and when the Manage Environments overlay closes, so still-mounted
 * agent pickers stay in sync without remounting.
 */
export function useReadySandboxEnvironments(): UseReadySandboxEnvironmentsResult {
  const environmentServer = useOptionalSandboxEnvironmentServer();
  const shell = useOptionalShellMode();
  const environmentsListEpoch = shell?.environmentsListEpoch ?? 0;
  const environmentsOpen = shell?.environmentsOpen ?? false;
  const [environments, setEnvironments] = useState<SandboxEnvironment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenRef = useRef(0);
  const wasEnvironmentsOpenRef = useRef(environmentsOpen);

  const fetchReadyEnvironments = useCallback(async () => {
    if (!environmentServer) {
      setEnvironments([]);
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
      const readyOnly = all.filter(env => env.status === 'ready');
      setEnvironments(readyOnly);
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
    void fetchReadyEnvironments();
  }, [fetchReadyEnvironments, environmentsListEpoch]);

  useEffect(() => {
    if (wasEnvironmentsOpenRef.current && !environmentsOpen) {
      void fetchReadyEnvironments();
    }
    wasEnvironmentsOpenRef.current = environmentsOpen;
  }, [environmentsOpen, fetchReadyEnvironments]);

  return {
    environments,
    loading,
    error,
    refetch: fetchReadyEnvironments,
  };
}
