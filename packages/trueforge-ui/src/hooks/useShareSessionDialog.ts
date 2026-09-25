'use client';

import { useCallback, useState } from 'react';

import { useToasterOptional } from '../containers/ToasterContainer.js';
import { buildSharedSessionHref } from '../routing/paths.js';
import { useOptionalResolvedRoutes } from '../routing/ResolvedRoutesContext.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { useCopySharedSessionLink } from './useCopySharedSessionLink.js';
import { useResourcePermissions } from './useResourcePermissions.js';

export type SessionSharePermission = 'private' | 'tenant';

export function useShareSessionDialog(sessionId: string | null | undefined): {
  permission: SessionSharePermission;
  canManage: boolean;
  loading: boolean;
  shareUrl: string;
  copied: boolean;
  tenantId: string | undefined;
  load: () => Promise<void>;
  changePermission: (next: SessionSharePermission) => Promise<void>;
  copySharedSessionLink: () => Promise<void>;
} {
  const server = useOptionalServer();
  const toaster = useToasterOptional();
  const routes = useOptionalResolvedRoutes();
  const resourceIds = sessionId == null || sessionId.length === 0 ? [] : [sessionId];
  const { allows } = useResourcePermissions({ resourceType: 'session', resourceIds });
  const canManage = allows(sessionId, 'MANAGE');
  const { copied, copySharedSessionLink } = useCopySharedSessionLink(sessionId);
  const [permission, setPermission] = useState<SessionSharePermission>('private');
  const [tenantId, setTenantId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const shareUrl =
    sessionId == null || sessionId.length === 0 ? '' : buildSharedSessionHref({ sessionId, routes });

  const load = useCallback(async () => {
    if (sessionId == null || sessionId.length === 0 || server == null) return;
    setLoading(true);
    try {
        const session = await server.getSession({ sessionId });
        setPermission(session.shared === true ? 'tenant' : 'private');
        if (server.getMe != null) {
          try {
            const me = await server.getMe();
            if (me.tenantId.length > 0) setTenantId(me.tenantId);
          } catch {
            // Keep the generic tenant label when identity is unavailable.
          }
        }
    } catch (caught) {
      toaster?.showError(caught);
    } finally {
      setLoading(false);
    }
  }, [server, sessionId, toaster]);

  const changePermission = useCallback(
    async (next: SessionSharePermission) => {
      const previous = permission;
      setPermission(next);
      if (sessionId == null || sessionId.length === 0 || server == null) return;
      try {
        await server.updateSession({ sessionId, shared: next === 'tenant' });
      } catch (caught) {
        setPermission(previous);
        toaster?.showError(caught);
      }
    },
    [permission, server, sessionId, toaster],
  );

  return {
    permission,
    canManage,
    loading,
    shareUrl,
    copied,
    tenantId,
    load,
    changePermission,
    copySharedSessionLink,
  };
}
