// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useThreadIsRunning = vi.fn(() => false);
const useAuiState = vi.fn();
const updateCustom = vi.fn(async () => undefined);
const getState = vi.fn(() => ({ custom: { isMutable: true } as Record<string, unknown> }));
const getSession = vi.fn();
const useOptionalServer = vi.fn((): { getSession: typeof getSession } | null => null);

vi.mock('@assistant-ui/core/react', () => ({
  useThreadIsRunning: () => useThreadIsRunning(),
}));

vi.mock('@/assistant-ui.js', () => ({
  useAui: () => ({
    threadListItem: () => ({ updateCustom, getState }),
  }),
  useAuiState: (selector: (state: unknown) => unknown) => useAuiState(selector),
}));

vi.mock('@/server/ServerContext.js', () => ({
  useOptionalServer: () => useOptionalServer(),
}));

import { useSyncThreadListLastTurnStatus } from '@/hooks/useSyncThreadListLastTurnStatus.js';

describe('useSyncThreadListLastTurnStatus', () => {
  beforeEach(() => {
    useThreadIsRunning.mockReturnValue(false);
    useOptionalServer.mockReturnValue({ getSession });
    updateCustom.mockClear();
    getSession.mockReset();
    getState.mockReturnValue({ custom: { isMutable: true } });
    useAuiState.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        threadListItem: { remoteId: 'sess-1' },
      }),
    );
  });

  it('stamps running onto the thread-list row when the live turn starts', async () => {
    useThreadIsRunning.mockReturnValue(true);
    renderHook(() => useSyncThreadListLastTurnStatus());

    await waitFor(() => {
      expect(updateCustom).toHaveBeenCalledWith({ isMutable: true, lastTurnStatus: 'running' });
    });
  });

  it('does not stamp running before the thread has a remote session id', async () => {
    useAuiState.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        threadListItem: { remoteId: undefined },
      }),
    );
    useThreadIsRunning.mockReturnValue(true);
    renderHook(() => useSyncThreadListLastTurnStatus());

    await act(async () => {
      await Promise.resolve();
    });

    expect(updateCustom).not.toHaveBeenCalled();
  });

  it('does not re-stamp when the row is already running', async () => {
    getState.mockReturnValue({ custom: { isMutable: true, lastTurnStatus: 'running' } });
    useThreadIsRunning.mockReturnValue(true);
    renderHook(() => useSyncThreadListLastTurnStatus());

    await act(async () => {
      await Promise.resolve();
    });

    expect(updateCustom).not.toHaveBeenCalled();
  });

  it('refreshes lastTurnStatus from getSession after a turn finishes', async () => {
    getSession.mockResolvedValue({
      id: 'sess-1',
      lastTurnDetails: { id: 'turn-1', state: { status: 'paused' } },
    });

    useThreadIsRunning.mockReturnValue(true);
    const { rerender } = renderHook(() => useSyncThreadListLastTurnStatus());
    updateCustom.mockClear();

    useThreadIsRunning.mockReturnValue(false);
    rerender();

    await waitFor(() => {
      expect(getSession).toHaveBeenCalledWith({ sessionId: 'sess-1' });
      expect(updateCustom).toHaveBeenCalledWith({ isMutable: true, lastTurnStatus: 'paused' });
    });
  });
});
