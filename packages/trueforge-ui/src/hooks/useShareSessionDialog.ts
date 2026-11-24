'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useToasterOptional } from '../containers/ToasterContainer.js';
import { buildSharedSessionHref } from '../routing/paths.js';
import { useOptionalResolvedRoutes } from '../routing/ResolvedRoutesContext.js';
import { useServerQueryClient } from '../server/queryClient.js';
import { queryKeys } from '../server/queryKeys.js';
import { useOptionalServer, useServerCapabilities } from '../server/ServerContext.js';
import type { DirectoryUser, SessionAccessGrant, SessionSubject } from '../server/types.js';
import { useCopySharedSessionLink } from './useCopySharedSessionLink.js';
import { useResourcePermissions } from './useResourcePermissions.js';

export const SESSION_SHARE_PRIVATE = 'private' as const;
export const SESSION_SHARE_TENANT = 'tenant' as const;

export type SessionSharePermission = typeof SESSION_SHARE_PRIVATE | typeof SESSION_SHARE_TENANT;

export function useShareSessionDialog(sessionId: string | null | undefined): {
  permission: SessionSharePermission;
  canManage: boolean;
  /** Tenant-wide sharing uses the tenant access grant. */
  canChangePermission: boolean;
  canShare: boolean;
  loading: boolean;
  shareUrl: string;
  copied: boolean;
  tenantId: string | undefined;
  owner: SessionSubject | undefined;
  collaborators: SessionAccessGrant[];
  load: () => Promise<void>;
  changePermission: (next: SessionSharePermission) => Promise<void>;
  invite: (users: DirectoryUser[]) => Promise<boolean>;
  removeCollaborator: (subjectId: string) => Promise<void>;
  copySharedSessionLink: () => Promise<void>;
} {
  const server = useOptionalServer();
  const queryClient = useServerQueryClient();
  const sessionAccess = server?.sessionAccess;
  const capabilities = useServerCapabilities();
  const toaster = useToasterOptional();
  const routes = useOptionalResolvedRoutes();
  const resourceIds = sessionId == null || sessionId.length === 0 ? [] : [sessionId];
  const { allows } = useResourcePermissions({ resourceType: 'session', resourceIds });
  const canManage = allows(sessionId, 'MANAGE');
  const { copied, copySharedSessionLink: copyLink } = useCopySharedSessionLink(sessionId);
  const [permission, setPermission] = useState<SessionSharePermission>(SESSION_SHARE_PRIVATE);
  const [tenantId, setTenantId] = useState<string | undefined>();
  const [owner, setOwner] = useState<SessionSubject | undefined>();
  const [collaborators, setCollaborators] = useState<SessionAccessGrant[]>([]);
  const collaboratorsRef = useRef(collaborators);
  collaboratorsRef.current = collaborators;
  // List fetches and invite/remove each bump this so an older listAccess cannot replace a newer list.
  const collaboratorListEpochRef = useRef(0);
  const collaboratorMutationsRef = useRef(0);
  const [loading, setLoading] = useState(false);

  const hasSession = sessionId != null && sessionId.length > 0;
  const shareUrl = hasSession ? buildSharedSessionHref({ sessionId, routes }) : '';
  const canChangePermission = canManage && sessionAccess != null && tenantId != null;
  // Absent until capabilities settle; hide invite so the field does not flash in.
  const canShareWithUsers = capabilities?.sessionSharing.granularity === 'subject';
  const canShare = canManage && sessionAccess != null && canShareWithUsers;

  const applyGrants = useCallback((grants: SessionAccessGrant[]) => {
    setCollaborators(grants.filter(grant => grant.subjectType === 'user'));
    setPermission(grants.some(grant => grant.subjectType === 'tenant') ? SESSION_SHARE_TENANT : SESSION_SHARE_PRIVATE);
  }, []);

  // Paints cached grants at once. Mount reads honor the default staleTime; opening the dialog
  // passes `fresh` so external grant changes show up. Concurrent calls share one request.
  const refreshCollaborators = useCallback(
    async ({ fresh = false }: { fresh?: boolean } = {}) => {
      if (!hasSession || sessionAccess == null || collaboratorMutationsRef.current > 0) return;
      const epoch = ++collaboratorListEpochRef.current;
      const queryKey = queryKeys.sessions.grants(sessionId);
      const cached = queryClient.getQueryData<SessionAccessGrant[]>(queryKey);
      if (cached != null) applyGrants(cached);
      const grants = await queryClient.fetchQuery({
        queryKey,
        queryFn: () => sessionAccess.listAccess({ sessionId }),
        ...(fresh ? { staleTime: 0 } : {}),
      });
      if (epoch !== collaboratorListEpochRef.current || collaboratorMutationsRef.current > 0) return;
      applyGrants(grants);
    },
    [applyGrants, hasSession, queryClient, sessionAccess, sessionId],
  );

  // Access grants include tenant sharing even when user invitations are unavailable.
  useEffect(() => {
    if (!canManage || !hasSession || sessionAccess == null) {
      collaboratorListEpochRef.current++;
      setCollaborators(current => (current.length === 0 ? current : []));
      return undefined;
    }
    let cancelled = false;
    void refreshCollaborators().catch(caught => {
      if (!cancelled) toaster?.showError(caught);
    });
    return () => {
      cancelled = true;
    };
    // toaster is read for errors only; its identity must not retrigger the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toaster
  }, [canManage, hasSession, refreshCollaborators, sessionAccess, sessionId]);

  const load = useCallback(async () => {
    if (!hasSession || server == null) return;
    setLoading(true);
    try {
      const session = await server.getSession({ sessionId });
      setOwner(session.createdBy);
      if (server.getMe != null) {
        try {
          const me = await server.getMe();
          if (me.tenantId.length > 0) setTenantId(me.tenantId);
        } catch {
          // Keep the generic tenant label when identity is unavailable.
        }
      }
      // Re-fetch on every open so external grant/revoke changes are visible.
      if (canManage && sessionAccess != null) await refreshCollaborators({ fresh: true });
    } catch (caught) {
      toaster?.showError(caught);
    } finally {
      setLoading(false);
    }
  }, [canManage, hasSession, refreshCollaborators, server, sessionAccess, sessionId, toaster]);

  const changePermission = useCallback(
    async (next: SessionSharePermission) => {
      if (!canChangePermission || next === permission || !hasSession || sessionAccess == null || tenantId == null) {
        return;
      }
      const previous = permission;
      setPermission(next);
      collaboratorMutationsRef.current++;
      collaboratorListEpochRef.current++;
      try {
        if (next === SESSION_SHARE_TENANT) {
          await sessionAccess.grantAccess({ sessionId, subjects: [{ subjectType: 'tenant', subjectId: tenantId }] });
        } else {
          await sessionAccess.revokeAccess({ sessionId, subjectType: 'tenant', subjectId: tenantId });
        }
      } catch (caught) {
        setPermission(previous);
        toaster?.showError(caught);
      } finally {
        // Tenant grants change the list shape in ways the cache cannot patch; drop it.
        queryClient.removeQueries({ queryKey: queryKeys.sessions.grants(sessionId) });
        collaboratorMutationsRef.current--;
        collaboratorListEpochRef.current++;
      }
    },
    [canChangePermission, hasSession, permission, queryClient, sessionAccess, sessionId, tenantId, toaster],
  );

  const invite = useCallback(
    async (users: DirectoryUser[]) => {
      if (!canShare || !hasSession || sessionAccess == null || users.length === 0) return false;
      collaboratorMutationsRef.current++;
      collaboratorListEpochRef.current++;
      try {
        const granted = await sessionAccess.grantAccess({
          sessionId,
          subjects: users.map(user => ({ subjectType: 'user', subjectId: user.id })),
        });
        setCollaborators(granted.filter(grant => grant.subjectType === 'user'));
        queryClient.setQueryData(queryKeys.sessions.grants(sessionId), granted);
        return true;
      } catch (caught) {
        toaster?.showError(caught);
        return false;
      } finally {
        collaboratorMutationsRef.current--;
        collaboratorListEpochRef.current++;
      }
    },
    [canShare, hasSession, queryClient, sessionAccess, sessionId, toaster],
  );

  const removeCollaborator = useCallback(
    async (subjectId: string) => {
      if (!canShare || !hasSession || sessionAccess == null) return;
      collaboratorMutationsRef.current++;
      collaboratorListEpochRef.current++;
      // Only this grant — a failed revoke must not resurrect peers removed concurrently.
      const removed = collaboratorsRef.current.find(grant => grant.subjectId === subjectId);
      setCollaborators(current => current.filter(grant => grant.subjectId !== subjectId));
      try {
        await sessionAccess.revokeAccess({ sessionId, subjectType: 'user', subjectId });
      } catch (caught) {
        if (removed != null) {
          setCollaborators(current =>
            current.some(item => item.subjectId === subjectId) ? current : [...current, removed],
          );
        }
        toaster?.showError(caught);
      } finally {
        queryClient.removeQueries({ queryKey: queryKeys.sessions.grants(sessionId) });
        collaboratorMutationsRef.current--;
        collaboratorListEpochRef.current++;
      }
    },
    [canShare, hasSession, queryClient, sessionAccess, sessionId, toaster],
  );

  const copySharedSessionLink = useCallback(async () => {
    if (!(await copyLink())) return;
    toaster?.showSuccess({
      title: 'Link copied to your clipboard',
      description:
        permission === SESSION_SHARE_TENANT
          ? 'Anyone in your workspace can open this link.'
          : 'Only invited collaborators can open this link.',
    });
  }, [copyLink, permission, toaster]);

  return {
    permission,
    canManage,
    canChangePermission,
    canShare,
    loading,
    shareUrl,
    copied,
    tenantId,
    owner,
    collaborators: canShare ? collaborators : [],
    load,
    changePermission,
    invite,
    removeCollaborator,
    copySharedSessionLink,
  };
}
