'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, createElement, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';

import { useServerQueryClient } from '../server/queryClient.js';
import { queryKeys } from '../server/queryKeys.js';
import { useOptionalPermissionsServer } from '../server/ServerContext.js';
import type { PermissionResourceType, PermissionsServer, ResourcePermission } from '../server/types.js';

const PERMISSIONS_BATCH_SIZE = 100;

const EMPTY_PERMISSIONS: Record<string, ResourcePermission[]> = {};

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

type PermissionsById = Record<string, ResourcePermission[]>;

type PermissionsQueryMeta = {
  server: PermissionsServer;
};

export function useResourcePermissions({
  resourceType,
  resourceIds,
}: UseResourcePermissionsOptions): UseResourcePermissionsResult {
  const server = useOptionalPermissionsServer();
  const queryClient = useServerQueryClient();
  const idsKey = JSON.stringify([...new Set(resourceIds.filter(resourceId => resourceId.length > 0))]);
  const requestedIds = useMemo(() => parseResourceIds(idsKey), [idsKey]);
  const requestedIdSet = useMemo(() => new Set(requestedIds), [requestedIds]);
  const enabled = server != null && requestedIds.length > 0;

  const query = useQuery(
    {
      queryKey: queryKeys.permissions.list({ resourceType, resourceIds: requestedIds }),
      queryFn: async (): Promise<PermissionsById> => {
        if (server == null) {
          throw new Error('permissions server missing');
        }
        const responses = await Promise.all(
          permissionBatches(requestedIds).map(resourceIdsBatch =>
            server.listPermissions({ resourceType, resourceIds: resourceIdsBatch }),
          ),
        );
        return Object.assign({}, ...responses.map(response => response.data.permissions));
      },
      enabled,
      // Keep prior grants while an expanded id set loads; drop them across server swaps (fail closed).
      placeholderData: (previousData, previousQuery) => {
        const previousServer = (previousQuery?.meta as PermissionsQueryMeta | undefined)?.server;
        if (previousServer !== server) return undefined;
        if (previousQuery != null && queryKeys.permissions.listResourceType(previousQuery.queryKey) !== resourceType) {
          return undefined;
        }
        return previousData;
      },
      meta: server == null ? undefined : ({ server } satisfies PermissionsQueryMeta),
    },
    queryClient,
  );

  // Survives a failed expansion so already-known grants stay usable (fail closed for new ids only).
  const lastSuccessRef = useRef<{
    server: PermissionsServer;
    resourceType: PermissionResourceType;
    data: PermissionsById;
  } | null>(null);
  if (server != null && query.isSuccess && query.data != null && !query.isPlaceholderData) {
    lastSuccessRef.current = { server, resourceType, data: query.data };
  }

  const data =
    query.data ??
    (lastSuccessRef.current?.server === server && lastSuccessRef.current.resourceType === resourceType
      ? lastSuccessRef.current.data
      : EMPTY_PERMISSIONS);

  const loading = enabled && (query.isPending || query.isFetching);
  const error = query.error ?? null;

  const allows = useCallback(
    (resourceId: string | null | undefined, permission: ResourcePermission) => {
      if (server == null || resourceId == null || resourceId === '') return true;
      if (!requestedIdSet.has(resourceId)) return false;
      return (data[resourceId] ?? []).includes(permission);
    },
    [data, requestedIdSet, server],
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
