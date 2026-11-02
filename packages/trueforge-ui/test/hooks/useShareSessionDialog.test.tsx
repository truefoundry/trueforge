// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session, SessionAccessGrant, SessionAccessServer } from '@/server/types.js';

type ServerHookValue = {
  getSession: (req: { sessionId: string }) => Promise<Session>;
  getMe: () => Promise<{ tenantId: string }>;
  updateSession: (req: { sessionId: string; shared?: boolean }) => Promise<Session>;
  sessionAccess?: Pick<SessionAccessServer, 'listAccess' | 'grantAccess' | 'revokeAccess'>;
};

const useOptionalServer = vi.hoisted(() => vi.fn<() => ServerHookValue | null>());
const useServerCapabilities = vi.hoisted(() => vi.fn<() => { sessionSharing?: { enabled: boolean } } | null>());
const allows = vi.hoisted(() => vi.fn<() => boolean>());
const showError = vi.hoisted(() => vi.fn());
const showSuccess = vi.hoisted(() => vi.fn());
const copyLink = vi.hoisted(() => vi.fn<() => Promise<boolean>>());

vi.mock('@/server/ServerContext.js', () => ({ useOptionalServer, useServerCapabilities }));
vi.mock('@/containers/ToasterContainer.js', () => ({
  useToasterOptional: () => ({ showError, showSuccess }),
}));
vi.mock('@/hooks/useResourcePermissions.js', () => ({ useResourcePermissions: () => ({ allows }) }));
vi.mock('@/routing/ResolvedRoutesContext.js', () => ({ useOptionalResolvedRoutes: () => undefined }));
vi.mock('@/routing/paths.js', () => ({ buildSharedSessionHref: () => 'https://app.test/shared' }));
vi.mock('@/hooks/useCopySharedSessionLink.js', () => ({
  useCopySharedSessionLink: () => ({ copied: false, copySharedSessionLink: copyLink }),
}));

import { useShareSessionDialog } from '@/hooks/useShareSessionDialog.js';

const session: Session = {
  id: 's1',
  isMutable: false,
  shared: false,
  createdBy: { id: 'owner', displayName: 'Owner' },
  createdAt: '2026-10-22T00:00:00Z',
  updatedAt: '2026-10-22T00:00:00Z',
};

function grant(overrides: Partial<SessionAccessGrant>): SessionAccessGrant {
  return {
    subjectType: 'user',
    subjectId: 'u1',
    displayName: 'Alice',
    email: 'alice@example.com',
    createdAt: '2026-10-22T00:00:00Z',
    ...overrides,
  };
}

describe('useShareSessionDialog', () => {
  const listAccess = vi.fn<SessionAccessServer['listAccess']>();
  const grantAccess = vi.fn<SessionAccessServer['grantAccess']>();
  const revokeAccess = vi.fn<SessionAccessServer['revokeAccess']>();
  const updateSession = vi.fn<(req: { sessionId: string; shared?: boolean }) => Promise<Session>>();
  const getSession = vi.fn<(req: { sessionId: string }) => Promise<Session>>();

  beforeEach(() => {
    vi.clearAllMocks();
    allows.mockReturnValue(true);
    useServerCapabilities.mockReturnValue({ sessionSharing: { enabled: true } });
    copyLink.mockResolvedValue(true);
    getSession.mockResolvedValue(session);
    listAccess.mockResolvedValue([grant({})]);
    grantAccess.mockResolvedValue([grant({}), grant({ subjectId: 'u2', displayName: 'Bob' })]);
    revokeAccess.mockResolvedValue(undefined);
    updateSession.mockImplementation(async req => ({ ...session, shared: req.shared === true }));
    useOptionalServer.mockReturnValue({
      getSession,
      getMe: () => Promise.resolve({ tenantId: 't1' }),
      updateSession,
      sessionAccess: { listAccess, grantAccess, revokeAccess },
    });
  });

  afterEach(cleanup);

  it('loads owner, user collaborators and permission from session.shared', async () => {
    getSession.mockResolvedValue({ ...session, shared: true });
    const { result } = renderHook(() => useShareSessionDialog('s1'));
    await act(() => result.current.load());

    expect(result.current.owner).toEqual({ id: 'owner', displayName: 'Owner' });
    expect(result.current.collaborators.map(item => item.subjectId)).toEqual(['u1']);
    expect(result.current.permission).toBe('tenant');
    expect(result.current.tenantId).toBe('t1');
  });

  it('refreshes collaborators on each load so external grant changes appear', async () => {
    const { result } = renderHook(() => useShareSessionDialog('s1'));
    await act(() => result.current.load());
    expect(result.current.collaborators.map(item => item.subjectId)).toEqual(['u1']);

    listAccess.mockResolvedValue([]);
    await act(() => result.current.load());
    expect(result.current.collaborators).toEqual([]);
  });

  it('does not list grants for viewers who cannot manage the session', async () => {
    allows.mockReturnValue(false);
    const { result } = renderHook(() => useShareSessionDialog('s1'));
    await act(() => result.current.load());

    expect(listAccess).not.toHaveBeenCalled();
    expect(result.current.canInvite).toBe(false);
    expect(result.current.canChangePermission).toBe(false);
  });

  it('hides invite when session_sharing.enabled is false and still allows tenant permission changes', async () => {
    useServerCapabilities.mockReturnValue({ sessionSharing: { enabled: false } });
    const { result } = renderHook(() => useShareSessionDialog('s1'));
    await act(() => result.current.load());

    expect(listAccess).not.toHaveBeenCalled();
    expect(result.current.canInvite).toBe(false);
    expect(result.current.canChangePermission).toBe(true);
  });

  it('hides invite when session_sharing is missing from capabilities', async () => {
    useServerCapabilities.mockReturnValue({});
    const { result } = renderHook(() => useShareSessionDialog('s1'));
    await act(() => result.current.load());

    expect(listAccess).not.toHaveBeenCalled();
    expect(result.current.canInvite).toBe(false);
    expect(result.current.canChangePermission).toBe(true);
  });

  it('shares with the tenant via updateSession shared and unshares the same way', async () => {
    listAccess.mockResolvedValue([]);
    const { result } = renderHook(() => useShareSessionDialog('s1'));
    await act(() => result.current.load());

    await act(() => result.current.changePermission('tenant'));
    expect(updateSession).toHaveBeenCalledWith({ sessionId: 's1', shared: true });
    expect(result.current.permission).toBe('tenant');

    await act(() => result.current.changePermission('private'));
    expect(updateSession).toHaveBeenCalledWith({ sessionId: 's1', shared: false });
    expect(result.current.permission).toBe('private');
  });

  it('rolls back the permission and reports the error when updateSession fails', async () => {
    listAccess.mockResolvedValue([]);
    const failure = new Error('forbidden');
    updateSession.mockRejectedValue(failure);
    const { result } = renderHook(() => useShareSessionDialog('s1'));
    await act(() => result.current.load());

    await act(() => result.current.changePermission('tenant'));

    expect(result.current.permission).toBe('private');
    expect(showError).toHaveBeenCalledWith(failure);
  });

  it('invites users and replaces the collaborator list with the returned grants', async () => {
    const { result } = renderHook(() => useShareSessionDialog('s1'));
    await act(() => result.current.load());

    let ok = false;
    await act(async () => {
      ok = await result.current.invite([{ id: 'u2', displayName: 'Bob', email: null }]);
    });

    expect(ok).toBe(true);
    expect(grantAccess).toHaveBeenCalledWith({ sessionId: 's1', subjects: [{ subjectType: 'user', subjectId: 'u2' }] });
    expect(result.current.collaborators.map(item => item.subjectId)).toEqual(['u1', 'u2']);
  });

  it('removes a collaborator optimistically and restores it when revoke fails', async () => {
    const failure = new Error('nope');
    revokeAccess.mockRejectedValue(failure);
    const { result } = renderHook(() => useShareSessionDialog('s1'));
    await act(() => result.current.load());

    await act(() => result.current.removeCollaborator('u1'));

    expect(revokeAccess).toHaveBeenCalledWith({ sessionId: 's1', subjectType: 'user', subjectId: 'u1' });
    expect(result.current.collaborators.map(item => item.subjectId)).toEqual(['u1']);
    expect(showError).toHaveBeenCalledWith(failure);
  });

  it('ignores a listAccess snapshot that arrives after a collaborator was removed', async () => {
    const bob = grant({ subjectId: 'u2', displayName: 'Bob', email: 'bob@example.com' });
    let releaseStale: (grants: SessionAccessGrant[]) => void = () => undefined;
    const stale = new Promise<SessionAccessGrant[]>(resolve => {
      releaseStale = resolve;
    });
    let calls = 0;
    listAccess.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? Promise.resolve([grant({}), bob]) : stale;
    });
    const { result } = renderHook(() => useShareSessionDialog('s1'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.collaborators.map(item => item.subjectId)).toEqual(['u1', 'u2']);

    let loadDone: Promise<void> = Promise.resolve();
    await act(async () => {
      loadDone = result.current.load();
      for (let attempt = 0; attempt < 10 && listAccess.mock.calls.length < 2; attempt += 1) {
        await Promise.resolve();
      }
    });
    expect(listAccess).toHaveBeenCalledTimes(2);

    await act(() => result.current.removeCollaborator('u2'));
    expect(result.current.collaborators.map(item => item.subjectId)).toEqual(['u1']);

    await act(async () => {
      releaseStale([grant({}), bob]);
      await loadDone;
    });
    expect(result.current.collaborators.map(item => item.subjectId)).toEqual(['u1']);
  });

  it('ignores a listAccess snapshot that arrives after an invite', async () => {
    let releaseStale: (grants: SessionAccessGrant[]) => void = () => undefined;
    const stale = new Promise<SessionAccessGrant[]>(resolve => {
      releaseStale = resolve;
    });
    let calls = 0;
    listAccess.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? Promise.resolve([grant({})]) : stale;
    });
    const { result } = renderHook(() => useShareSessionDialog('s1'));
    await act(async () => {
      await Promise.resolve();
    });

    let loadDone: Promise<void> = Promise.resolve();
    await act(async () => {
      loadDone = result.current.load();
      for (let attempt = 0; attempt < 10 && listAccess.mock.calls.length < 2; attempt += 1) {
        await Promise.resolve();
      }
    });

    await act(() => result.current.invite([{ id: 'u2', displayName: 'Bob', email: null }]));
    expect(result.current.collaborators.map(item => item.subjectId)).toEqual(['u1', 'u2']);

    await act(async () => {
      releaseStale([grant({})]);
      await loadDone;
    });
    expect(result.current.collaborators.map(item => item.subjectId)).toEqual(['u1', 'u2']);
  });

  it('on concurrent removals, a failed revoke restores only that collaborator', async () => {
    listAccess.mockResolvedValue([grant({}), grant({ subjectId: 'u2', displayName: 'Bob', email: 'bob@example.com' })]);
    let rejectU1: (reason: Error) => void = () => undefined;
    const u1Failed = new Promise<never>((_, reject) => {
      rejectU1 = reject;
    });
    revokeAccess.mockImplementation(async req => {
      if (req.subjectId === 'u1') return u1Failed;
    });
    const { result } = renderHook(() => useShareSessionDialog('s1'));
    await act(() => result.current.load());

    let removeU1: Promise<void> = Promise.resolve();
    await act(() => {
      removeU1 = result.current.removeCollaborator('u1');
      return result.current.removeCollaborator('u2');
    });
    expect(result.current.collaborators).toEqual([]);

    await act(async () => {
      rejectU1(new Error('nope'));
      await removeU1.catch(() => undefined);
    });

    expect(result.current.collaborators.map(item => item.subjectId)).toEqual(['u1']);
    expect(showError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('toasts the audience after copying the link, and nothing when the copy fails', async () => {
    getSession.mockResolvedValue({ ...session, shared: true });
    const { result } = renderHook(() => useShareSessionDialog('s1'));
    await act(() => result.current.load());

    await act(() => result.current.copySharedSessionLink());
    expect(showSuccess).toHaveBeenCalledWith({
      title: 'Link copied to your clipboard',
      description: 'Anyone in your workspace can open this link.',
    });

    showSuccess.mockClear();
    copyLink.mockResolvedValue(false);
    await act(() => result.current.copySharedSessionLink());
    expect(showSuccess).not.toHaveBeenCalled();
  });
});
