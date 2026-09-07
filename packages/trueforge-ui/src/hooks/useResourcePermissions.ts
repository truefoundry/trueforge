'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useOptionalPermissionsServer } from '../server/ServerContext.js';
import type { PermissionResourceType, ResourcePermission } from '../server/types.js';

const PERMISSIONS_BATCH_SIZE = 100;

type PermissionsLoadState = {
  key: string;
  data: Record<string, ResourcePermission[]>;
  loading: boolean;
  error: unknown | null;
};

export type UseResourcePermissionsOptions = {
  resourceType: PermissionResourceType;
  resourceIds: readonly string[];
};

export type UseResourcePermissionsResult = {
  loading: boolean;
  error: unknown | null;
  allows: (resourceId: string | null | undefined, permission: ResourcePermission) => boolean;
};

function parseResourceIds(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((resourceId): resourceId is string => typeof resourceId === 'string');
}

function permissionBatches(resourceIds: string[]): string[][] {
  const batches: string[][] = [];
  for (let offset = 0; offset < resourceIds.length; offset += PERMISSIONS_BATCH_SIZE) {
    batches.push(resourceIds.slice(offset, offset + PERMISSIONS_BATCH_SIZE));
  }
  return batches;
}

export function useResourcePermissions({
  resourceType,
  resourceIds,
}: UseResourcePermissionsOptions): UseResourcePermissionsResult {
  const server = useOptionalPermissionsServer();
  const idsKey = JSON.stringify([...new Set(resourceIds.filter(resourceId => resourceId.length > 0))]);
  const hasResourceIds = idsKey !== '[]';
  const requestKey = `${resourceType}:${idsKey}`;
  const [state, setState] = useState<PermissionsLoadState>({
    key: '',
    data: {},
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (server == null || !hasResourceIds) return;

    let cancelled = false;
    const requestedIds = parseResourceIds(idsKey);
    setState({ key: requestKey, data: {}, loading: true, error: null });
    void Promise.all(
      permissionBatches(requestedIds).map(resourceIdsBatch =>
        server.listPermissions({ resourceType, resourceIds: resourceIdsBatch }),
      ),
    ).then(
      responses => {
        if (cancelled) return;
        setState({
          key: requestKey,
          data: Object.assign({}, ...responses.map(response => response.data)),
          loading: false,
          error: null,
        });
      },
      caught => {
        if (cancelled) return;
        setState({ key: requestKey, data: {}, loading: false, error: caught });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [hasResourceIds, idsKey, requestKey, resourceType, server]);

  const ready =
    server == null || !hasResourceIds || (state.key === requestKey && !state.loading && state.error == null);
  const loading = server != null && hasResourceIds && (state.key !== requestKey || state.loading);
  const error = state.key === requestKey ? state.error : null;

  const allows = useCallback(
    (resourceId: string | null | undefined, permission: ResourcePermission) => {
      if (server == null || resourceId == null || resourceId === '') return true;
      if (!hasResourceIds) return false;
      return ready && (state.data[resourceId] ?? []).includes(permission);
    },
    [hasResourceIds, ready, server, state.data],
  );

  return { loading, error, allows };
}

const ActiveSessionManageContext = createContext(true);

export function ActiveSessionPermissionsProvider({
  sessionId,
  children,
}: {
  sessionId: string | null | undefined;
  children: ReactNode;
}) {
  const resourceIds = useMemo(() => (sessionId == null ? [] : [sessionId]), [sessionId]);
  const { allows } = useResourcePermissions({ resourceType: 'session', resourceIds });
  return createElement(ActiveSessionManageContext.Provider, { value: allows(sessionId, 'MANAGE') }, children);
}

export function useActiveSessionCanManage(): boolean {
  return useContext(ActiveSessionManageContext);
}
