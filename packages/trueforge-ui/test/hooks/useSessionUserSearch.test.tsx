// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DirectoryUser, ListResult, SessionAccessServer } from '@/server/types.js';

type ServerHookValue = { sessionAccess?: Pick<SessionAccessServer, 'searchUsers'> };

const useOptionalServer = vi.hoisted(() => vi.fn<() => ServerHookValue | null>());

vi.mock('@/server/ServerContext.js', () => ({ useOptionalServer }));
// Stable identity, like the real provider; a fresh object per render would retrigger the search effect.
const toaster = vi.hoisted(() => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock('@/containers/ToasterContainer.js', () => ({ useToasterOptional: () => toaster }));

import { useSessionUserSearch } from '@/hooks/useSessionUserSearch.js';

const alice: DirectoryUser = { id: 'u1', displayName: 'Alice', email: 'alice@example.com' };
const bob: DirectoryUser = { id: 'u2', displayName: 'Bob', email: null };

describe('useSessionUserSearch', () => {
  const searchUsers = vi.fn<SessionAccessServer['searchUsers']>();

  beforeEach(() => {
    vi.useFakeTimers();
    searchUsers.mockReset();
    toaster.showError.mockReset();
    useOptionalServer.mockReturnValue({ sessionAccess: { searchUsers } });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('debounces typing into a single search and skips empty queries', async () => {
    searchUsers.mockResolvedValue({ data: [alice] });
    const { result } = renderHook(() => useSessionUserSearch({ enabled: true }));

    act(() => result.current.setQuery('a'));
    act(() => result.current.setQuery('al'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(searchUsers).toHaveBeenCalledTimes(1);
    expect(searchUsers).toHaveBeenCalledWith({ query: 'al', limit: 25 });
    expect(result.current.users).toEqual([alice]);

    act(() => result.current.setQuery('  '));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(searchUsers).toHaveBeenCalledTimes(1);
    expect(result.current.users).toEqual([]);
  });

  it('appends the next page without duplicating users', async () => {
    searchUsers
      .mockResolvedValueOnce({ data: [alice], nextPageToken: 'p2' })
      .mockResolvedValueOnce({ data: [alice, bob] } satisfies ListResult<DirectoryUser>);
    const { result } = renderHook(() => useSessionUserSearch({ enabled: true }));

    act(() => result.current.setQuery('a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      result.current.loadMore();
      await Promise.resolve();
    });

    expect(searchUsers).toHaveBeenLastCalledWith({ query: 'a', limit: 25, pageToken: 'p2' });
    expect(result.current.users).toEqual([alice, bob]);
    expect(result.current.hasMore).toBe(false);
  });

  it('ignores a stale response when the query changed mid-flight', async () => {
    let resolveFirst: (page: ListResult<DirectoryUser>) => void = () => undefined;
    searchUsers
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ data: [bob] });
    const { result } = renderHook(() => useSessionUserSearch({ enabled: true }));

    act(() => result.current.setQuery('a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    act(() => result.current.setQuery('b'));
    expect(result.current.users).toEqual([]);
    await act(async () => {
      resolveFirst({ data: [alice] });
      await Promise.resolve();
    });
    expect(result.current.users).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.users).toEqual([bob]);
  });

  it('resets pagination on query change and blocks loadMore until the first page returns', async () => {
    searchUsers.mockResolvedValueOnce({ data: [alice], nextPageToken: 'p2' }).mockResolvedValueOnce({ data: [bob] });
    const { result } = renderHook(() => useSessionUserSearch({ enabled: true }));

    act(() => result.current.setQuery('a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.setQuery('b'));
    expect(result.current.users).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loading).toBe(true);

    act(() => {
      result.current.loadMore();
    });
    expect(searchUsers).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(searchUsers).toHaveBeenCalledTimes(2);
    expect(searchUsers).toHaveBeenLastCalledWith({ query: 'b', limit: 25 });
    expect(result.current.users).toEqual([bob]);
  });

  it('reports search failures through the toaster', async () => {
    const failure = new Error('boom');
    searchUsers.mockRejectedValue(failure);
    const { result } = renderHook(() => useSessionUserSearch({ enabled: true }));

    act(() => result.current.setQuery('a'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(toaster.showError).toHaveBeenCalledWith(failure);
  });
});
