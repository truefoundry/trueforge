// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  ActiveSessionPermissionsProvider,
  useActiveSessionCanManage,
  useResourcePermissions,
} from '@/hooks/useResourcePermissions.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { ListPermissionsResponse, PermissionResourceType } from '@/server/types.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

/** ServerProvider mounts CanCreateAgentProvider, which also calls listPermissions for tenant. */
const TENANT_RESPONSE: ListPermissionsResponse = { data: { type: 'tenant', permissions: {} } };

function listPermissionsMock(
  impl: (args: { resourceType: PermissionResourceType; resourceIds: string[] }) => Promise<ListPermissionsResponse>,
) {
  return vi.fn(
    async (args: { resourceType: PermissionResourceType; resourceIds: string[] }): Promise<ListPermissionsResponse> => {
      if (args.resourceType === 'tenant') return TENANT_RESPONSE;
      return impl(args);
    },
  );
}

describe('useResourcePermissions', () => {
  it('allows without a permissions port', () => {
    const { result } = renderHook(() => useResourcePermissions({ resourceType: 'agent', resourceIds: ['agent-1'] }));

    expect(result.current.loading).toBe(false);
    expect(result.current.allows('agent-1', 'MANAGE')).toBe(true);
  });

  it('fails closed until grants load and denies missing ids', async () => {
    let resolvePermissions: ((value: ListPermissionsResponse) => void) | undefined;
    const listPermissions = listPermissionsMock(
      () =>
        new Promise<ListPermissionsResponse>(resolve => {
          resolvePermissions = resolve;
        }),
    );
    const server = createMockAgentUIServer({ permissions: { listPermissions } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServerProvider server={server}>{children}</ServerProvider>
    );
    const { result } = renderHook(
      () => useResourcePermissions({ resourceType: 'agent', resourceIds: ['agent-1', 'missing'] }),
      { wrapper },
    );

    expect(result.current.allows('agent-1', 'MANAGE')).toBe(false);
    await act(async () => {
      resolvePermissions?.({ data: { type: 'agent', permissions: { 'agent-1': ['USE', 'MANAGE'] } } });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allows('agent-1', 'USE')).toBe(true);
    expect(result.current.allows('agent-1', 'MANAGE')).toBe(true);
    expect(result.current.allows('agent-1', 'DELETE')).toBe(false);
    expect(result.current.allows('missing', 'MANAGE')).toBe(false);
  });

  it('chunks requests at 100 ids and fails closed on errors', async () => {
    const listPermissions = listPermissionsMock(async ({ resourceIds }): Promise<ListPermissionsResponse> => ({
      data: {
        type: 'session',
        permissions: Object.fromEntries(resourceIds.map(resourceId => [resourceId, ['DELETE']])),
      },
    }));
    const server = createMockAgentUIServer({ permissions: { listPermissions } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServerProvider server={server}>{children}</ServerProvider>
    );
    const resourceIds = Array.from({ length: 101 }, (_, index) => `session-${String(index)}`);
    const { result, rerender } = renderHook(
      ({ ids }) => useResourcePermissions({ resourceType: 'session', resourceIds: ids }),
      { initialProps: { ids: resourceIds }, wrapper },
    );

    await waitFor(() => expect(result.current.allows('session-100', 'DELETE')).toBe(true));
    expect(listPermissions.mock.calls.filter(([req]) => req.resourceType === 'session')).toHaveLength(2);

    listPermissions.mockImplementationOnce(async args => {
      if (args.resourceType === 'tenant') return TENANT_RESPONSE;
      throw new Error('permission service unavailable');
    });
    rerender({ ids: ['session-error'] });
    await waitFor(() => expect(result.current.error).toEqual(new Error('permission service unavailable')));
    expect(result.current.allows('session-error', 'DELETE')).toBe(false);
  });

  it('keeps known grants while an expanded request loads and fails', async () => {
    let rejectExpanded: ((reason: unknown) => void) | undefined;
    const knownResponse: ListPermissionsResponse = {
      data: { type: 'session', permissions: { known: ['MANAGE'] } },
    };
    let nonTenantCalls = 0;
    const listPermissions = listPermissionsMock(() => {
      nonTenantCalls += 1;
      if (nonTenantCalls === 1) return Promise.resolve(knownResponse);
      return new Promise<ListPermissionsResponse>((_resolve, reject) => {
        rejectExpanded = reject;
      });
    });
    const server = createMockAgentUIServer({ permissions: { listPermissions } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServerProvider server={server}>{children}</ServerProvider>
    );
    const { result, rerender } = renderHook(
      ({ ids }) => useResourcePermissions({ resourceType: 'session', resourceIds: ids }),
      { initialProps: { ids: ['known'] }, wrapper },
    );

    await waitFor(() => expect(result.current.allows('known', 'MANAGE')).toBe(true));
    rerender({ ids: ['known', 'new'] });
    expect(result.current.allows('known', 'MANAGE')).toBe(true);
    expect(result.current.allows('new', 'MANAGE')).toBe(false);

    await act(async () => {
      rejectExpanded?.(new Error('permission service unavailable'));
    });
    await waitFor(() => expect(result.current.error).toEqual(new Error('permission service unavailable')));
    expect(result.current.allows('known', 'MANAGE')).toBe(true);
    expect(result.current.allows('new', 'MANAGE')).toBe(false);
  });

  it('keeps a locally created active session manageable while permissions load', () => {
    const server = createMockAgentUIServer({
      permissions: {
        listPermissions: vi.fn(() => new Promise<ListPermissionsResponse>(() => undefined)),
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServerProvider server={server}>
        <ActiveSessionPermissionsProvider sessionId="new-session" assumeManage>
          {children}
        </ActiveSessionPermissionsProvider>
      </ServerProvider>
    );
    const { result } = renderHook(() => useActiveSessionCanManage(), { wrapper });

    expect(result.current).toBe(true);
  });

  it('keeps a loaded active session read-only while permissions load', () => {
    const server = createMockAgentUIServer({
      permissions: {
        listPermissions: vi.fn(() => new Promise<ListPermissionsResponse>(() => undefined)),
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServerProvider server={server}>
        <ActiveSessionPermissionsProvider sessionId="loaded-session">{children}</ActiveSessionPermissionsProvider>
      </ServerProvider>
    );
    const { result } = renderHook(() => useActiveSessionCanManage(), { wrapper });

    expect(result.current).toBe(false);
  });
});
