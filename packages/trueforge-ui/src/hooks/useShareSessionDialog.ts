'use client';

import { useCallback, useState } from 'react';

import { useToasterOptional } from '../containers/ToasterContainer.js';
import { buildSharedSessionHref } from '../routing/paths.js';
import { useOptionalResolvedRoutes } from '../routing/ResolvedRoutesContext.js';
import { useOptionalServer } from '../server/ServerContext.js';
import type { DirectoryUser, SessionAccessGrant, SessionSubject } from '../server/types.js';
import { useCopySharedSessionLink } from './useCopySharedSessionLink.js';
import { useResourcePermissions } from './useResourcePermissions.js';

export type SessionSharePermission = 'private' | 'tenant';

export function useShareSessionDialog(sessionId: string | null | undefined): {
  permission: SessionSharePermission;
  canManage: boolean;
  /** Sharing writes need the access port and the caller's tenant id. */
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
  const toaster = useToasterOptional();
  const routes = useOptionalResolvedRoutes();
  const resourceIds = sessionId == null || sessionId.length === 0 ? [] : [sessionId];
  const { allows } = useResourcePermissions({ resourceType: 'session', resourceIds });
  const canManage = allows(sessionId, 'MANAGE');
  const { copied, copySharedSessionLink: copyLink } = useCopySharedSessionLink(sessionId);
  const [permission, setPermission] = useState<SessionSharePermission>('private');
  const [tenantId, setTenantId] = useState<string | undefined>();
  const [owner, setOwner] = useState<SessionSubject | undefined>();
  const [collaborators, setCollaborators] = useState<SessionAccessGrant[]>([]);
  const [loading, setLoading] = useState(false);

  const hasSession = sessionId != null && sessionId.length > 0;
  const shareUrl = hasSession ? buildSharedSessionHref({ sessionId, routes }) : '';
  const canChangePermission = canManage && sessionAccess != null && tenantId != null;
  const canInvite = canManage && sessionAccess != null;

  const load = useCallback(async () => {
    if (!hasSession || server == null) return;
    setLoading(true);
    try {
      const session = await server.getSession({ sessionId });
      setOwner(session.createdBy);
      setPermission(session.shared === true ? 'tenant' : 'private');
      if (server.getMe != null) {
        try {
          const me = await server.getMe();
          if (me.tenantId.length > 0) setTenantId(me.tenantId);
        } catch {
          // Keep the generic tenant label when identity is unavailable.
        }
      }
      // Grants are creator-only; other viewers would get a 403.
      if (sessionAccess != null && canManage) {
        const grants = await sessionAccess.listAccess({ sessionId });
        setCollaborators(grants.filter(grant => grant.subjectType === 'user'));
        setPermission(grants.some(grant => grant.subjectType === 'tenant') ? 'tenant' : 'private');
      }
    } catch (caught) {
      toaster?.showError(caught);
    } finally {
      setLoading(false);
    }
  }, [canManage, hasSession, server, sessionAccess, sessionId, toaster]);

  const changePermission = useCallback(
    async (next: SessionSharePermission) => {
      if (!canChangePermission || next === permission || !hasSession || sessionAccess == null || tenantId == null) {
        return;
      }
      const previous = permission;
      setPermission(next);
      try {
        const subject = { subjectType: 'tenant', subjectId: tenantId } as const;
        if (next === 'tenant') await sessionAccess.grantAccess({ sessionId, subjects: [subject] });
        else await sessionAccess.revokeAccess({ sessionId, ...subject });
      } catch (caught) {
        setPermission(previous);
        toaster?.showError(caught);
      }
    },
    [canChangePermission, hasSession, permission, sessionAccess, sessionId, tenantId, toaster],
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
        permission === 'tenant'
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
