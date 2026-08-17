// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SEARCH_AGENTS_PAGE_SIZE, useSearchAgentsList } from '@/atoms/lib/useSearchAgentsList.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentLibraryEntry, AgentUIServer } from '@/server/types.js';
import { createMockAgentUIServer } from '../../server/mockServer.js';

function wrapperFor(server: AgentUIServer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ServerProvider server={server}>{children}</ServerProvider>;
  };
}

describe('useSearchAgentsList', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches the first page when enabled and paginates via loadMore sentinel', async () => {
    const page1 = Array.from({ length: SEARCH_AGENTS_PAGE_SIZE }, (_, i) => ({
      name: `agent-${i}`,
      agentId: `agent-${i}`,
    }));
    const page2 = [{ name: 'agent-extra', agentId: 'agent-extra' }];
    const searchAgents = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const server = createMockAgentUIServer({ searchAgents });
    const { result } = renderHook(() => useSearchAgentsList({ enabled: true, query: '' }), {
      wrapper: wrapperFor(server),
    });

    await waitFor(() => expect(result.current.agents).toHaveLength(SEARCH_AGENTS_PAGE_SIZE));
    expect(result.current.hasMore).toBe(true);
    expect(searchAgents).toHaveBeenCalledWith({ query: undefined, limit: SEARCH_AGENTS_PAGE_SIZE, offset: 0 });

    const observers: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          observers.push(cb);
        }
        observe() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
        unobserve() {
          return undefined;
        }
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    );

    act(() => {
      result.current.listRef(document.createElement('div'));
      result.current.sentinelRef(document.createElement('div'));
    });

    await waitFor(() => expect(observers.length).toBeGreaterThan(0));

    act(() => {
      observers[0]?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    await waitFor(() => expect(result.current.agents).toHaveLength(SEARCH_AGENTS_PAGE_SIZE + 1));
    expect(searchAgents).toHaveBeenCalledWith({
      query: undefined,
      limit: SEARCH_AGENTS_PAGE_SIZE,
      offset: SEARCH_AGENTS_PAGE_SIZE,
    });
    expect(result.current.hasMore).toBe(false);
  });

  it('debounces query changes before re-fetching', async () => {
    vi.useFakeTimers();
    const searchAgents = vi.fn(async ({ query }: { query?: string } = {}) => [
      { name: query ?? 'all', agentId: query ?? 'all' },
    ]);
    const server = createMockAgentUIServer({ searchAgents });

    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useSearchAgentsList({ enabled: true, query }),
      { wrapper: wrapperFor(server), initialProps: { query: '' } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(searchAgents).toHaveBeenCalledTimes(1);

    rerender({ query: 'alpha' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(searchAgents).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(searchAgents).toHaveBeenCalledTimes(2);
    expect(searchAgents).toHaveBeenLastCalledWith({ query: 'alpha', limit: SEARCH_AGENTS_PAGE_SIZE, offset: 0 });
    expect(result.current.agents).toEqual([{ name: 'alpha', agentId: 'alpha' } satisfies AgentLibraryEntry]);
  });
});
