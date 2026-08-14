// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThreadListContainer } from '@/containers/ThreadListContainer.js';

const { loadMore } = vi.hoisted(() => ({
  loadMore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({
    threads: () => ({
      loadMore,
      switchToThread: vi.fn(),
      switchToNewThread: vi.fn(),
    }),
  }),
  useAuiState: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      threads: {
        isLoading: false,
        isLoadingMore: false,
        hasMore: true,
        threadIds: ['t1'],
        threadItems: [{ id: 't1', remoteId: 's1', lastMessageAt: undefined }],
        mainThreadId: 't1',
      },
      threadListItem: {
        id: 't1',
        remoteId: 's1',
        title: 'Session',
        lastMessageAt: undefined,
        custom: undefined,
      },
    }),
  ThreadListItemByIndexProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  ThreadListPrimitive: {
    Root: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
  },
  ThreadListItemPrimitive: {
    Root: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    Delete: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  },
  ThreadListItemMorePrimitive: {
    Root: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Trigger: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
    Content: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  },
}));

vi.mock('@/server/ServerContext.js', () => ({
  useOptionalServer: () => undefined,
}));

vi.mock('@/server/ShellModeContext.js', () => ({
  useOptionalShellMode: () => ({
    isLibraryEnabled: false,
    isNewChatEnabled: true,
    isComposerEnabled: false,
    mode: { status: 'active', isMutable: false, agentName: 'agent', agentId: 'agent', locked: false },
    setSettingsOpen: vi.fn(),
    selectLibraryAgent: vi.fn(),
    openDraft: vi.fn(),
    openHistorySession: vi.fn(),
  }),
}));

function getViewport(container: HTMLElement): HTMLElement {
  const viewport = container.querySelector('[data-slot="aui_thread-list-viewport"]');
  if (!(viewport instanceof HTMLElement)) {
    throw new Error('Expected thread list viewport');
  }
  return viewport;
}

afterEach(() => {
  vi.restoreAllMocks();
  loadMore.mockReset().mockResolvedValue(undefined);
});

describe('ThreadListContainer pagination', () => {
  it('rechecks an underflowing viewport after a Strict Mode effect remount', () => {
    loadMore.mockReturnValue(new Promise<void>(() => {}));
    const scrollHeight = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(200);
    const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);

    render(
      <StrictMode>
        <ThreadListContainer />
      </StrictMode>,
    );

    expect(loadMore).toHaveBeenCalledTimes(2);
    scrollHeight.mockRestore();
    clientHeight.mockRestore();
  });

  it('loads more when the first page does not fill the viewport', async () => {
    loadMore.mockClear();
    const { container } = render(<ThreadListContainer />);
    const viewport = getViewport(container);

    Object.defineProperty(viewport, 'scrollTop', { configurable: true, value: 0 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 200 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 400 });
    fireEvent(window, new Event('resize'));

    await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(1));
  });

  it('loads more when scrolled near the bottom', async () => {
    loadMore.mockClear();
    const { container } = render(<ThreadListContainer />);
    const viewport = getViewport(container);

    Object.defineProperty(viewport, 'scrollTop', { configurable: true, value: 520 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 800 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 200 });
    fireEvent.scroll(viewport);

    await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(1));
  });

  it('does not load more before reaching the bottom', async () => {
    loadMore.mockClear();
    const { container } = render(<ThreadListContainer />);
    const viewport = getViewport(container);

    Object.defineProperty(viewport, 'scrollTop', { configurable: true, value: 50 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 800 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 200 });
    fireEvent.scroll(viewport);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('does not load more at the top of an overflowing list', async () => {
    loadMore.mockClear();
    const { container } = render(<ThreadListContainer />);
    const viewport = getViewport(container);

    Object.defineProperty(viewport, 'scrollTop', { configurable: true, value: 0 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 800 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 200 });
    fireEvent(window, new Event('resize'));

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loadMore).not.toHaveBeenCalled();
  });
});
