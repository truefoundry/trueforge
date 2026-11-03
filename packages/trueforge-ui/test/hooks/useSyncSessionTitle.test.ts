// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useThreadIsRunning = vi.fn(() => false);
const useAuiState = vi.fn();
const generateTitle = vi.fn(async () => undefined);
const rename = vi.fn(async () => undefined);

vi.mock('@assistant-ui/core/react', () => ({
  useThreadIsRunning: () => useThreadIsRunning(),
}));

vi.mock('@/assistant-ui.js', () => ({
  useAui: () => ({
    threadListItem: () => ({ generateTitle, rename }),
  }),
  useAuiState: (selector: (state: unknown) => unknown) => useAuiState(selector),
}));

import { useSyncSessionTitle } from '@/hooks/useSyncSessionTitle.js';

function mockThreadListItem(item: { remoteId: string | undefined; title: string | undefined }) {
  useAuiState.mockImplementation((selector: (state: unknown) => unknown) => selector({ threadListItem: item }));
}

async function finishTurn() {
  useThreadIsRunning.mockReturnValue(true);
  const { rerender } = renderHook(() => useSyncSessionTitle());
  useThreadIsRunning.mockReturnValue(false);
  rerender();
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useSyncSessionTitle', () => {
  beforeEach(() => {
    useThreadIsRunning.mockReturnValue(false);
    generateTitle.mockClear();
    rename.mockClear();
    mockThreadListItem({ remoteId: 'sess-1', title: undefined });
  });

  it('generates the title without renaming after a turn finishes', async () => {
    await finishTurn();

    expect(generateTitle).toHaveBeenCalledTimes(1);
    expect(rename).not.toHaveBeenCalled();
  });

  it('attempts only once per session even when no title arrives', async () => {
    useThreadIsRunning.mockReturnValue(true);
    const { rerender } = renderHook(() => useSyncSessionTitle());
    for (let i = 0; i < 2; i++) {
      useThreadIsRunning.mockReturnValue(false);
      rerender();
      useThreadIsRunning.mockReturnValue(true);
      rerender();
    }
    useThreadIsRunning.mockReturnValue(false);
    rerender();
    await act(async () => {
      await Promise.resolve();
    });

    expect(generateTitle).toHaveBeenCalledTimes(1);
  });

  it('attempts again after switching to another session', async () => {
    useThreadIsRunning.mockReturnValue(true);
    const { rerender } = renderHook(() => useSyncSessionTitle());
    useThreadIsRunning.mockReturnValue(false);
    rerender();

    mockThreadListItem({ remoteId: 'sess-2', title: undefined });
    useThreadIsRunning.mockReturnValue(true);
    rerender();
    useThreadIsRunning.mockReturnValue(false);
    rerender();
    await act(async () => {
      await Promise.resolve();
    });

    expect(generateTitle).toHaveBeenCalledTimes(2);
  });

  it('skips rows that already have a title', async () => {
    mockThreadListItem({ remoteId: 'sess-1', title: 'Existing title' });

    await finishTurn();

    expect(generateTitle).not.toHaveBeenCalled();
  });

  it('skips rows without a remote id', async () => {
    mockThreadListItem({ remoteId: undefined, title: undefined });

    await finishTurn();

    expect(generateTitle).not.toHaveBeenCalled();
  });

  it('does nothing while the turn is still running', async () => {
    useThreadIsRunning.mockReturnValue(true);
    renderHook(() => useSyncSessionTitle());

    await act(async () => {
      await Promise.resolve();
    });

    expect(generateTitle).not.toHaveBeenCalled();
  });
});
