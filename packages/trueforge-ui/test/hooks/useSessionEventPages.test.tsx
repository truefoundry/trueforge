// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useSessionEventPages } from '@/hooks/useSessionEventPages.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentSessionsServer, ListResult, SessionEventItem } from '@/server/types.js';
import { createMockAgentSessionsServer, createMockAgentUIServer } from '../server/mockServer.js';

function item(id: string): SessionEventItem {
  return {
    turnId: 'turn-1',
    event: { type: 'model.message', id, threadId: 'main', content: id, createdAt: '2026-01-01T00:00:00.000Z' },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function wrapperFor(listSessionEvents: AgentSessionsServer['listSessionEvents']) {
  const server = createMockAgentUIServer({ sessions: createMockAgentSessionsServer({ listSessionEvents }) });
  return ({ children }: { children: ReactNode }) => <ServerProvider server={server}>{children}</ServerProvider>;
}

function ids(state: ReturnType<typeof useSessionEventPages>['state']): string[] {
  return state.status === 'ready' ? state.itemsAsc.map(entry => entry.event.id) : [];
}

describe('useSessionEventPages', () => {
  it('exposes the newest page before older pages finish, then prepends them chronologically', async () => {
    const older = deferred<ListResult<SessionEventItem>>();
    const listSessionEvents = vi.fn(async ({ pageToken }: { pageToken?: string }) =>
      pageToken == null ? { data: [item('e4'), item('e3')], nextPageToken: 'older' } : older.promise,
    );

    const { result } = renderHook(() => useSessionEventPages({ sessionId: 'sess-1', refreshKey: 0 }), {
      wrapper: wrapperFor(listSessionEvents),
    });

    await waitFor(() => expect(ids(result.current.state)).toEqual(['e3', 'e4']));
    expect(result.current.state).toMatchObject({ status: 'ready', loadingOlder: true });

    await act(async () => older.resolve({ data: [item('e2'), item('e1')] }));

    expect(ids(result.current.state)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(result.current.state).toMatchObject({ status: 'ready', loadingOlder: false, olderFailed: false });
  });

  it('reports a first-page failure as an error', async () => {
    const failure = new Error('boom');
    const { result } = renderHook(() => useSessionEventPages({ sessionId: 'sess-1', refreshKey: 0 }), {
      wrapper: wrapperFor(async () => Promise.reject(failure)),
    });

    await waitFor(() => expect(result.current.state).toEqual({ status: 'error', error: failure }));
  });

  it('keeps loaded events when an older page fails and resumes from that page on retry', async () => {
    let olderAttempts = 0;
    const listSessionEvents = vi.fn(async ({ pageToken }: { pageToken?: string }) => {
      if (pageToken == null) return { data: [item('e2')], nextPageToken: 'older' };
      olderAttempts += 1;
      if (olderAttempts === 1) throw new Error('flaky');
      return { data: [item('e1')] };
    });

    const { result } = renderHook(() => useSessionEventPages({ sessionId: 'sess-1', refreshKey: 0 }), {
      wrapper: wrapperFor(listSessionEvents),
    });

    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'ready', olderFailed: true }));
    expect(ids(result.current.state)).toEqual(['e2']);

    act(() => result.current.retryOlder());

    await waitFor(() => expect(ids(result.current.state)).toEqual(['e1', 'e2']));
    expect(listSessionEvents).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: 'older' }));
  });

  it('drops pages for a session that is no longer selected', async () => {
    const stale = deferred<ListResult<SessionEventItem>>();
    const listSessionEvents = vi.fn(async ({ sessionId }: { sessionId: string }) =>
      sessionId === 'sess-1' ? stale.promise : { data: [item('b1')] },
    );

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useSessionEventPages({ sessionId, refreshKey: 0 }),
      { wrapper: wrapperFor(listSessionEvents), initialProps: { sessionId: 'sess-1' } },
    );

    rerender({ sessionId: 'sess-2' });
    await waitFor(() => expect(ids(result.current.state)).toEqual(['b1']));

    await act(async () => stale.resolve({ data: [item('a1')] }));
    expect(ids(result.current.state)).toEqual(['b1']);
  });
});
