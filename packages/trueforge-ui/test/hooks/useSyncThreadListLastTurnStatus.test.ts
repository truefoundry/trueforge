// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useThreadIsRunning = vi.fn(() => false);
const useAuiState = vi.fn();
const updateCustom = vi.fn(async (_custom: Record<string, unknown>) => undefined);
const getState = vi.fn(() => ({ custom: { isMutable: true } as Record<string, unknown> }));
const getSession = vi.fn();
const useOptionalServer = vi.fn((): { getSession: typeof getSession } | null => null);
const aui = {
  threadListItem: () => ({ updateCustom, getState }),
};

vi.mock('@assistant-ui/core/react', () => ({
  useThreadIsRunning: () => useThreadIsRunning(),
}));

vi.mock('@/assistant-ui.js', () => ({
  useAui: () => aui,
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
      expect(updateCustom).toHaveBeenCalledWith(
        expect.objectContaining({ isMutable: true, lastTurnStatus: 'running' }),
      );
    });
    const activityAt = updateCustom.mock.calls[0]?.[0]?.lastActivityAt;
    expect(typeof activityAt).toBe('string');
    if (typeof activityAt !== 'string') {
      throw new Error('expected lastActivityAt string');
    }
    expect(Number.isNaN(new Date(activityAt).getTime())).toBe(false);
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

  it('clears running immediately when a turn finishes, then refreshes from getSession', async () => {
    getState.mockReturnValue({ custom: { isMutable: true, lastTurnStatus: 'running' } });
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
      expect(updateCustom).toHaveBeenCalledWith({ isMutable: true });
      expect(getSession).toHaveBeenCalledWith({ sessionId: 'sess-1' });
      expect(updateCustom).toHaveBeenCalledWith({ isMutable: true, lastTurnStatus: 'paused' });
    });
  });

  it('still clears running when getSession fails after a turn finishes', async () => {
    getState.mockReturnValue({ custom: { isMutable: true, lastTurnStatus: 'running' } });
    getSession.mockRejectedValue(new Error('network'));

    useThreadIsRunning.mockReturnValue(true);
    const { rerender } = renderHook(() => useSyncThreadListLastTurnStatus());
    updateCustom.mockClear();

    useThreadIsRunning.mockReturnValue(false);
    rerender();

    await waitFor(() => {
      expect(updateCustom).toHaveBeenCalledWith({ isMutable: true });
    });
    expect(updateCustom).not.toHaveBeenCalledWith(expect.objectContaining({ lastTurnStatus: 'running' }));
  });

  it('does not treat leaving a running thread as the next session finishing a turn', async () => {
    getState.mockReturnValue({ custom: { isMutable: true, lastTurnStatus: 'running' } });
    useThreadIsRunning.mockReturnValue(true);
    const { rerender } = renderHook(() => useSyncThreadListLastTurnStatus());
    updateCustom.mockClear();
    getSession.mockClear();

    useAuiState.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        threadListItem: { remoteId: 'sess-2' },
      }),
    );
    useThreadIsRunning.mockReturnValue(false);
    rerender();

    await act(async () => {
      await Promise.resolve();
    });

    expect(updateCustom).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it('still stamps the finished status when lastMessageAt changes while getSession is in flight', async () => {
    getState.mockReturnValue({ custom: { isMutable: true, lastTurnStatus: 'running' } });
    let resolveSession: (session: {
      id: string;
      updatedAt: string;
      lastTurnDetails: { id: string; state: { status: 'paused' } };
    }) => void = () => undefined;
    getSession.mockReturnValue(
      new Promise(resolve => {
        resolveSession = resolve;
      }),
    );

    useThreadIsRunning.mockReturnValue(true);
    const { rerender } = renderHook(() => useSyncThreadListLastTurnStatus());
    updateCustom.mockClear();

    useThreadIsRunning.mockReturnValue(false);
    rerender();

    await waitFor(() => {
      expect(getSession).toHaveBeenCalledTimes(1);
    });

    useAuiState.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        threadListItem: { remoteId: 'sess-1', lastMessageAt: new Date('2026-11-16T12:00:00.000Z') },
      }),
    );
    rerender();

    resolveSession({
      id: 'sess-1',
      updatedAt: '2026-11-16T12:00:01.000Z',
      lastTurnDetails: { id: 'turn-1', state: { status: 'paused' } },
    });

    await waitFor(() => {
      expect(updateCustom).toHaveBeenCalledWith({
        isMutable: true,
        lastTurnStatus: 'paused',
        lastActivityAt: '2026-11-16T12:00:01.000Z',
      });
    });
  });
});
