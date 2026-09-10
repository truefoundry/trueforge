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
import type { PermissionResourceType, PermissionsServer, ResourcePermission } from '../server/types.js';

const PERMISSIONS_BATCH_SIZE = 100;

type PermissionsLoadState = {
  server: PermissionsServer | null;
  resourceType: PermissionResourceType | null;
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
  const requestedIds = useMemo(() => parseResourceIds(idsKey), [idsKey]);
  const requestedIdSet = useMemo(() => new Set(requestedIds), [requestedIds]);
  const [state, setState] = useState<PermissionsLoadState>({
    server: null,
    resourceType: null,
    key: '',
    data: {},
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (server == null || !hasResourceIds) return;

    let cancelled = false;
    setState(current =>
      current.server === server && current.resourceType === resourceType
        ? { ...current, key: requestKey, loading: true, error: null }
        : { server, resourceType, key: requestKey, data: {}, loading: true, error: null },
    );
    void Promise.all(
      permissionBatches(requestedIds).map(resourceIdsBatch =>
        server.listPermissions({ resourceType, resourceIds: resourceIdsBatch }),
      ),
    ).then(
      responses => {
        if (cancelled) return;
        setState({
          server,
          resourceType,
          key: requestKey,
          data: Object.assign({}, ...responses.map(response => response.data)),
          loading: false,
          error: null,
        });
      },
      caught => {
        if (cancelled) return;
        setState(current => ({
          server,
          resourceType,
          key: requestKey,
          data: current.server === server && current.resourceType === resourceType ? current.data : {},
          loading: false,
          error: caught,
        }));
      },
    );

    return () => {
      cancelled = true;
    };
  }, [hasResourceIds, requestKey, requestedIds, resourceType, server]);

  const sameScope = state.server === server && state.resourceType === resourceType;
  const loading = server != null && hasResourceIds && (!sameScope || state.key !== requestKey || state.loading);
  const error = sameScope && state.key === requestKey ? state.error : null;

  const allows = useCallback(
    (resourceId: string | null | undefined, permission: ResourcePermission) => {
      if (server == null || resourceId == null || resourceId === '') return true;
      if (!requestedIdSet.has(resourceId) || !sameScope) return false;
      return (state.data[resourceId] ?? []).includes(permission);
    },
    [requestedIdSet, sameScope, server, state.data],
  );

  return { loading, error, allows };
}

const ActiveSessionManageContext = createContext(true);

export function ActiveSessionPermissionsProvider({
  sessionId,
  assumeManage = false,
  children,
}: {
  sessionId: string | null | undefined;
  assumeManage?: boolean;
  children: ReactNode;
}) {
  const resourceIds = useMemo(() => (sessionId == null ? [] : [sessionId]), [sessionId]);
  const { allows } = useResourcePermissions({ resourceType: 'session', resourceIds });
  return createElement(
    ActiveSessionManageContext.Provider,
    { value: assumeManage || allows(sessionId, 'MANAGE') },
    children,
  );
}

export function useActiveSessionCanManage(): boolean {
  return useContext(ActiveSessionManageContext);
}
