'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useOptionalSandboxEnvironmentServer } from '../../server/ServerContext.js';
import type { SandboxEnvironment } from '../../server/types.js';
import { getErrorMessage } from '../../utils/getErrorMessage.js';

export type UseReadySandboxEnvironmentsResult = {
  environments: SandboxEnvironment[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

/**
 * Loads sandbox environments and filters strictly to ready (`status === 'active'`) records.
 * Environments still building (`pending`) or failed (`failed`) are excluded.
 */
export function useReadySandboxEnvironments(): UseReadySandboxEnvironmentsResult {
  const environmentServer = useOptionalSandboxEnvironmentServer();
  const [environments, setEnvironments] = useState<SandboxEnvironment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenRef = useRef(0);

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
      // Fetch all accessible environments (default page size up to max 25 or unpaginated list)
      const res = await environmentServer.listEnvironments({ limit: 100 });
      if (gen !== requestGenRef.current) return;
      const readyOnly = res.data.filter(env => env.status === 'active');
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
  }, [fetchReadyEnvironments]);

  return {
    environments,
    loading,
    error,
    refetch: fetchReadyEnvironments,
  };
}
