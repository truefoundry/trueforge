// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useThreadIsRunning = vi.fn(() => false);
const useAuiState = vi.fn();
const rename = vi.fn(async () => undefined);
const getSession = vi.fn();
const useOptionalServer = vi.fn((): { getSession: typeof getSession } | null => null);

vi.mock('@assistant-ui/core/react', () => ({
  useThreadIsRunning: () => useThreadIsRunning(),
}));

vi.mock('@/assistant-ui.js', () => ({
  useAui: () => ({
    threadListItem: () => ({ rename }),
  }),
  useAuiState: (selector: (state: unknown) => unknown) => useAuiState(selector),
}));

vi.mock('@/server/ServerContext.js', () => ({
  useOptionalServer: () => useOptionalServer(),
}));

import { useSyncSessionTitle } from '@/hooks/useSyncSessionTitle.js';

describe('useSyncSessionTitle', () => {
  beforeEach(() => {
    useThreadIsRunning.mockReturnValue(false);
    useOptionalServer.mockReturnValue({ getSession });
    rename.mockClear();
    getSession.mockReset();
    useAuiState.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        threadListItem: { remoteId: 'sess-1', title: undefined },
      }),
    );
  });

  it('renames the thread list row from getSession.title after a turn finishes', async () => {
    getSession.mockResolvedValue({
      id: 'sess-1',
      isMutable: true,
      createdAt: '2026-08-10T12:28:03.327Z',
      updatedAt: '2026-08-10T12:28:03.366Z',
      title: 'Hello chat, how are you?',
    });

    useThreadIsRunning.mockReturnValue(true);
    const { rerender } = renderHook(() => useSyncSessionTitle());

    useThreadIsRunning.mockReturnValue(false);
    rerender();

    await waitFor(() => {
      expect(getSession).toHaveBeenCalledWith({ sessionId: 'sess-1' });
      expect(rename).toHaveBeenCalledWith('Hello chat, how are you?');
    });
  });

  it('does not fetch when the row already has a title', async () => {
    useAuiState.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        threadListItem: { remoteId: 'sess-1', title: 'Existing title' },
      }),
    );

    useThreadIsRunning.mockReturnValue(true);
    const { rerender } = renderHook(() => useSyncSessionTitle());

    useThreadIsRunning.mockReturnValue(false);
    rerender();

    await act(async () => {
      await Promise.resolve();
    });

    expect(getSession).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it('does not fetch while the turn is still running', async () => {
    useThreadIsRunning.mockReturnValue(true);
    renderHook(() => useSyncSessionTitle());

    await act(async () => {
      await Promise.resolve();
    });

    expect(getSession).not.toHaveBeenCalled();
  });
});
