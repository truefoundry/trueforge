// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useResourcePermissions } from '@/hooks/useResourcePermissions.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { ResourcePermission } from '@/server/types.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

describe('useResourcePermissions', () => {
  it('allows without a permissions port', () => {
    const { result } = renderHook(() => useResourcePermissions({ resourceType: 'agent', resourceIds: ['agent-1'] }));

    expect(result.current.loading).toBe(false);
    expect(result.current.allows('agent-1', 'MANAGE')).toBe(true);
  });

  it('fails closed until grants load and denies missing ids', async () => {
    let resolvePermissions: ((value: { data: Record<string, ResourcePermission[]> }) => void) | undefined;
    const listPermissions = vi.fn(
      () =>
        new Promise<{ data: Record<string, ResourcePermission[]> }>(resolve => {
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
      resolvePermissions?.({ data: { 'agent-1': ['USE', 'MANAGE'] } });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allows('agent-1', 'USE')).toBe(true);
    expect(result.current.allows('agent-1', 'MANAGE')).toBe(true);
    expect(result.current.allows('agent-1', 'DELETE')).toBe(false);
    expect(result.current.allows('missing', 'MANAGE')).toBe(false);
  });

  it('chunks requests at 100 ids and fails closed on errors', async () => {
    const listPermissions = vi.fn(async ({ resourceIds }: { resourceIds: string[] }) => ({
      data: Object.fromEntries(resourceIds.map(resourceId => [resourceId, ['DELETE' as const]])),
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
    expect(listPermissions).toHaveBeenCalledTimes(2);

    listPermissions.mockRejectedValueOnce(new Error('permission service unavailable'));
    rerender({ ids: ['session-error'] });
    await waitFor(() => expect(result.current.error).toEqual(new Error('permission service unavailable')));
    expect(result.current.allows('session-error', 'DELETE')).toBe(false);
  });
});
