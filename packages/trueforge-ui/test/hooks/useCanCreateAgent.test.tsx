// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useCanCreateAgent } from '@/hooks/useCanCreateAgent.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { ListPermissionsResponse } from '@/server/types.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

describe('useCanCreateAgent', () => {
  it('allows create when no permissions port is configured', () => {
    const { result } = renderHook(() => useCanCreateAgent());
    expect(result.current).toEqual({ loading: false, canCreateAgent: true });
  });

  it('fails closed until tenant CREATE loads', async () => {
    let resolvePermissions: ((value: ListPermissionsResponse) => void) | undefined;
    const listPermissions = vi.fn(
      () =>
        new Promise<ListPermissionsResponse>(resolve => {
          resolvePermissions = resolve;
        }),
    );
    const server = createMockAgentUIServer({ permissions: { listPermissions } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServerProvider server={server}>{children}</ServerProvider>
    );
    const { result } = renderHook(() => useCanCreateAgent(), { wrapper });

    expect(result.current).toEqual({ loading: true, canCreateAgent: false });
    expect(listPermissions).toHaveBeenCalledWith({ resourceType: 'tenant', resourceIds: [] });

    await act(async () => {
      resolvePermissions?.({ data: { type: 'tenant', permissions: { agent: ['CREATE'] } } });
    });
    await waitFor(() => expect(result.current).toEqual({ loading: false, canCreateAgent: true }));
  });

  it('denies create when CREATE is absent', async () => {
    const server = createMockAgentUIServer({
      permissions: {
        listPermissions: vi.fn(async (): Promise<ListPermissionsResponse> => ({
          data: { type: 'tenant', permissions: { agent: [] } },
        })),
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServerProvider server={server}>{children}</ServerProvider>
    );
    const { result } = renderHook(() => useCanCreateAgent(), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ loading: false, canCreateAgent: false }));
  });

  it('denies create when the permissions request fails', async () => {
    const server = createMockAgentUIServer({
      permissions: {
        listPermissions: vi.fn(async () => {
          throw new Error('unavailable');
        }),
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ServerProvider server={server}>{children}</ServerProvider>
    );
    const { result } = renderHook(() => useCanCreateAgent(), { wrapper });
    await waitFor(() => expect(result.current).toEqual({ loading: false, canCreateAgent: false }));
  });
});
