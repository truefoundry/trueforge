'use client';

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';

import type { PermissionsServer } from '../server/types.js';

export type UseCanCreateAgentResult = {
  loading: boolean;
  /** False while loading, on error, or when CREATE is not granted (fail-closed). */
  canCreateAgent: boolean;
  /** False while loading, on error, or when sandbox environment CREATE is not granted. */
  canCreateSandboxEnvironment: boolean;
};

const CanCreateAgentContext = createContext<UseCanCreateAgentResult>({
  loading: false,
  canCreateAgent: true,
  canCreateSandboxEnvironment: true,
});

/**
 * Fetches tenant-scoped CREATE grants once for the given permissions server
 * and broadcasts the result via context. Mount once high in the tree (inside
 * ServerProvider) so every useCanCreateAgent consumer shares a single
 * list-permissions call instead of each firing its own.
 */
export function CanCreateAgentProvider({
  permissionsServer,
  children,
}: {
  permissionsServer: PermissionsServer | null;
  children: ReactNode;
}) {
  const [state, setState] = useState<UseCanCreateAgentResult>({
    loading: permissionsServer != null,
    canCreateAgent: permissionsServer == null,
    canCreateSandboxEnvironment: permissionsServer == null,
  });

  useEffect(() => {
    if (permissionsServer == null) {
      setState({ loading: false, canCreateAgent: true, canCreateSandboxEnvironment: true });
      return;
    }

    let cancelled = false;
    setState({ loading: true, canCreateAgent: false, canCreateSandboxEnvironment: false });
    void permissionsServer
      .listPermissions({ resourceType: 'tenant', resourceIds: [] })
      .then(response => {
        if (cancelled) return;
        const agentGranted = response.data.permissions.agent ?? [];
        const environmentGranted = response.data.permissions.sandbox_environment ?? [];
        setState({
          loading: false,
          canCreateAgent: agentGranted.includes('CREATE'),
          canCreateSandboxEnvironment: environmentGranted.includes('CREATE'),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ loading: false, canCreateAgent: false, canCreateSandboxEnvironment: false });
      });

    return () => {
      cancelled = true;
    };
  }, [permissionsServer]);

  return createElement(CanCreateAgentContext.Provider, { value: state }, children);
}

/**
 * Tenant-scoped create grants. Reads from CanCreateAgentProvider (mounted
 * inside ServerProvider). Falls back to allow-all when no permissions port is configured.
 */
export function useCanCreateAgent(): UseCanCreateAgentResult {
  return useContext(CanCreateAgentContext);
}
