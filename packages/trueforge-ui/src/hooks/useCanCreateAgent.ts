'use client';

import { useEffect, useState } from 'react';

import { useOptionalPermissionsServer } from '../server/ServerContext.js';

export type UseCanCreateAgentResult = {
  loading: boolean;
  /** False while loading, on error, or when CREATE is not granted (fail-closed). */
  canCreateAgent: boolean;
};

/**
 * Tenant-scoped create-agent grant via `list-permissions` (`resource_type: tenant`).
 * When no permissions server is configured (standalone without port), allows create.
 */
export function useCanCreateAgent(): UseCanCreateAgentResult {
  const server = useOptionalPermissionsServer();
  const [state, setState] = useState<{ loading: boolean; canCreateAgent: boolean }>({
    loading: server != null,
    canCreateAgent: server == null,
  });

  useEffect(() => {
    if (server == null) {
      setState({ loading: false, canCreateAgent: true });
      return;
    }

    let cancelled = false;
    setState({ loading: true, canCreateAgent: false });
    void server
      .listPermissions({ resourceType: 'tenant', resourceIds: [] })
      .then(response => {
        if (cancelled) return;
        const granted = response.data.permissions.agent ?? [];
        setState({ loading: false, canCreateAgent: granted.includes('CREATE') });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ loading: false, canCreateAgent: false });
      });

    return () => {
      cancelled = true;
    };
  }, [server]);

  return state;
}
