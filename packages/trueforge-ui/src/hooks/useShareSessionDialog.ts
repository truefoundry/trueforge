'use client';

import { useCallback, useEffect, useState } from 'react';

import { useToasterOptional } from '../containers/ToasterContainer.js';
import { buildSharedSessionHref } from '../routing/paths.js';
import { useOptionalResolvedRoutes } from '../routing/ResolvedRoutesContext.js';
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
  /** Tenant-wide sharing is a session `shared` write; needs MANAGE only. */
  canChangePermission: boolean;
  canInvite: boolean;
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
  const [loading, setLoading] = useState(false);

  const hasSession = sessionId != null && sessionId.length > 0;
  const shareUrl = hasSession ? buildSharedSessionHref({ sessionId, routes }) : '';
  const canChangePermission = canManage;
  // Absent until capabilities settle; hide invite so the field does not flash in.
  const canInviteUsers = capabilities?.sessionSharing?.enabled === true;
  const canInvite = canManage && sessionAccess != null && canInviteUsers;

  // Runs when invite-by-user becomes available (capabilities settle after open).
  useEffect(() => {
    if (!canInvite || !hasSession || sessionAccess == null) {
      setCollaborators(current => (current.length === 0 ? current : []));
      return undefined;
    }
    let cancelled = false;
    void sessionAccess
      .listAccess({ sessionId })
      .then(grants => {
        if (!cancelled) setCollaborators(grants.filter(grant => grant.subjectType === 'user'));
      })
      .catch(caught => {
        if (!cancelled) toaster?.showError(caught);
      });
    return () => {
      cancelled = true;
    };
    // toaster is read for errors only; its identity must not retrigger the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toaster
  }, [canInvite, hasSession, sessionAccess, sessionId]);

  const load = useCallback(async () => {
    if (!hasSession || server == null) return;
    setLoading(true);
    try {
      const session = await server.getSession({ sessionId });
      setOwner(session.createdBy);
      setPermission(session.shared === true ? SESSION_SHARE_TENANT : SESSION_SHARE_PRIVATE);
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
  }, [hasSession, server, sessionId, toaster]);

  const changePermission = useCallback(
    async (next: SessionSharePermission) => {
      if (!canChangePermission || next === permission || !hasSession || server == null) {
        return;
      }
      const previous = permission;
      setPermission(next);
      try {
        await server.updateSession({ sessionId, shared: next === SESSION_SHARE_TENANT });
      } catch (caught) {
        setPermission(previous);
        toaster?.showError(caught);
      }
    },
    [canChangePermission, hasSession, permission, server, sessionId, toaster],
  );

  const invite = useCallback(
    async (users: DirectoryUser[]) => {
      if (!canInvite || !hasSession || sessionAccess == null || users.length === 0) return false;
      try {
        const granted = await sessionAccess.grantAccess({
          sessionId,
          subjects: users.map(user => ({ subjectType: 'user', subjectId: user.id })),
        });
        setCollaborators(granted.filter(grant => grant.subjectType === 'user'));
        return true;
      } catch (caught) {
        toaster?.showError(caught);
        return false;
      }
    },
    [canInvite, hasSession, sessionAccess, sessionId, toaster],
  );

  const removeCollaborator = useCallback(
    async (subjectId: string) => {
      if (!canInvite || !hasSession || sessionAccess == null) return;
      const previous = collaborators;
      setCollaborators(current => current.filter(grant => grant.subjectId !== subjectId));
      try {
        await sessionAccess.revokeAccess({ sessionId, subjectType: 'user', subjectId });
      } catch (caught) {
        setCollaborators(previous);
        toaster?.showError(caught);
      }
    },
    [canInvite, collaborators, hasSession, sessionAccess, sessionId, toaster],
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
    canInvite,
    loading,
    shareUrl,
    copied,
    tenantId,
    owner,
    collaborators,
    load,
    changePermission,
    invite,
    removeCollaborator,
    copySharedSessionLink,
  };
}
