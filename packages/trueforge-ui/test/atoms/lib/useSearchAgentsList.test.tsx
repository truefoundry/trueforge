// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  findAgentByName,
  findLibraryAgent,
  SEARCH_AGENTS_PAGE_SIZE,
  useSearchAgentsList,
} from '@/atoms/lib/useSearchAgentsList.js';
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

  it('finds an exact name on a later filtered search page', async () => {
    const firstPage = Array.from({ length: SEARCH_AGENTS_PAGE_SIZE }, (_, index) => ({
      name: `helper-copy-${index}`,
      agentId: `copy-${index}`,
    }));
    const searchAgents = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, nextPageToken: 'tok_2' })
      .mockResolvedValueOnce({ data: [{ name: 'helper', agentId: 'helper-id' }] });

    await expect(
      findAgentByName({
        server: createMockAgentUIServer({ searchAgents }),
        agentName: 'helper',
      }),
    ).resolves.toEqual({ name: 'helper', agentId: 'helper-id' });
    expect(searchAgents).toHaveBeenLastCalledWith({
      query: 'helper',
      limit: SEARCH_AGENTS_PAGE_SIZE,
      pageToken: 'tok_2',
    });
  });

  it('finds an agent by id when name search would miss', async () => {
    const firstPage = Array.from({ length: SEARCH_AGENTS_PAGE_SIZE }, (_, index) => ({
      name: `other-${index}`,
      agentId: `id-${index}`,
    }));
    const searchAgents = vi
      .fn()
      .mockResolvedValueOnce({ data: firstPage, nextPageToken: 'tok_2' })
      .mockResolvedValueOnce({ data: [{ name: 'Demo Bot', agentId: 'agt_demo' }] });

    await expect(
      findLibraryAgent({
        server: createMockAgentUIServer({ searchAgents }),
        agentKey: 'agt_demo',
      }),
    ).resolves.toEqual({ name: 'Demo Bot', agentId: 'agt_demo' });
    expect(searchAgents).toHaveBeenLastCalledWith({
      limit: SEARCH_AGENTS_PAGE_SIZE,
      pageToken: 'tok_2',
    });
  });

  it('fetches the first page when enabled and paginates via loadMore sentinel', async () => {
    const page1 = Array.from({ length: SEARCH_AGENTS_PAGE_SIZE }, (_, i) => ({
      name: `agent-${i}`,
      agentId: `agent-${i}`,
    }));
    const page2 = [{ name: 'agent-extra', agentId: 'agent-extra' }];
    const searchAgents = vi
      .fn()
      .mockResolvedValueOnce({ data: page1, nextPageToken: 'tok_2' })
      .mockResolvedValueOnce({ data: page2 });

    const server = createMockAgentUIServer({ searchAgents });
    const { result } = renderHook(() => useSearchAgentsList({ enabled: true, query: '' }), {
      wrapper: wrapperFor(server),
    });

    await waitFor(() => expect(result.current.agents).toHaveLength(SEARCH_AGENTS_PAGE_SIZE));
    expect(result.current.hasMore).toBe(true);
    expect(searchAgents).toHaveBeenCalledWith({ query: undefined, limit: SEARCH_AGENTS_PAGE_SIZE });

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
      pageToken: 'tok_2',
    });
    expect(result.current.hasMore).toBe(false);
  });

  it('debounces query changes before re-fetching', async () => {
    vi.useFakeTimers();
    const searchAgents = vi.fn(async ({ query }: { query?: string } = {}) => ({
      data: [{ name: query ?? 'all', agentId: query ?? 'all' }],
    }));
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
    expect(searchAgents).toHaveBeenLastCalledWith({ query: 'alpha', limit: SEARCH_AGENTS_PAGE_SIZE });
    expect(result.current.agents).toEqual([{ name: 'alpha', agentId: 'alpha' } satisfies AgentLibraryEntry]);
  });

  it('paged mode replaces rows and navigates by page tokens', async () => {
    const page1 = Array.from({ length: 10 }, (_, i) => ({
      name: `agent-${i}`,
      agentId: `agent-${i}`,
    }));
    const page2 = [{ name: 'agent-10', agentId: 'agent-10' }];
    const searchAgents = vi
      .fn()
      .mockResolvedValueOnce({ data: page1, nextPageToken: 'tok_2' })
      .mockResolvedValueOnce({ data: page2, previousPageToken: 'tok_1' })
      .mockResolvedValueOnce({ data: page1, nextPageToken: 'tok_2' });

    const server = createMockAgentUIServer({ searchAgents });
    const { result } = renderHook(() => useSearchAgentsList({ enabled: true, query: '', mode: 'paged', limit: 10 }), {
      wrapper: wrapperFor(server),
    });

    await waitFor(() => expect(result.current.agents).toHaveLength(10));
    expect(result.current.canNext).toBe(true);
    expect(result.current.canPrev).toBe(false);
    expect(searchAgents).toHaveBeenCalledWith({ query: undefined, limit: 10 });

    act(() => {
      result.current.goNext();
    });
    await waitFor(() => expect(result.current.agents).toEqual(page2));
    expect(searchAgents).toHaveBeenCalledWith({ query: undefined, limit: 10, pageToken: 'tok_2' });
    expect(result.current.canPrev).toBe(true);
    expect(result.current.canNext).toBe(false);

    act(() => {
      result.current.goPrev();
    });
    await waitFor(() => expect(result.current.agents).toHaveLength(10));
    expect(searchAgents).toHaveBeenLastCalledWith({ query: undefined, limit: 10, pageToken: 'tok_1' });
  });

  it('disables next when the only page is exactly full but has no next token', async () => {
    const page = Array.from({ length: 10 }, (_, i) => ({
      name: `agent-${i}`,
      agentId: `agent-${i}`,
    }));
    const searchAgents = vi.fn().mockResolvedValue({ data: page });
    const server = createMockAgentUIServer({ searchAgents });
    const { result } = renderHook(() => useSearchAgentsList({ enabled: true, query: '', mode: 'paged', limit: 10 }), {
      wrapper: wrapperFor(server),
    });

    await waitFor(() => expect(result.current.agents).toHaveLength(10));
    expect(result.current.canNext).toBe(false);
    expect(result.current.canPrev).toBe(false);
  });
});
