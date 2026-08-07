// @vitest-environment jsdom
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const loadMore = vi.fn().mockResolvedValue(undefined);

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({
    threads: () => ({
      loadMore,
      switchToThread: vi.fn(),
      switchToNewThread: vi.fn(),
    }),
  }),
  useAuiState: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      threads: {
        isLoading: false,
        isLoadingMore: false,
        hasMore: true,
        threadIds: ['t1'],
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
  ThreadListPrimitive: {
    Root: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    Items: ({ children }: { children: (args: { threadListItem: { remoteId: string } }) => ReactNode }) => (
      <>{children({ threadListItem: { remoteId: 's1' } })}</>
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

vi.mock('../server/ServerContext.js', () => ({
  useOptionalServer: () => undefined,
}));

vi.mock('../server/ShellModeContext.js', () => ({
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

import { ThreadListContainer } from './ThreadListContainer.js';

describe('ThreadListContainer pagination', () => {
  it('does not load more pages until the history list is scrolled', async () => {
    loadMore.mockClear();
    const { container } = render(
      <div style={{ height: 200 }}>
        <ThreadListContainer />
      </div>,
    );

    const viewport = container.querySelector('[data-slot="aui_thread-list-viewport"]');
    expect(viewport).toBeTruthy();

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loadMore).not.toHaveBeenCalled();

    Object.defineProperty(viewport, 'scrollTop', { configurable: true, value: 720 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 800 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 200 });
    fireEvent.scroll(viewport!);

    await waitFor(() => expect(loadMore).toHaveBeenCalledTimes(1));
  });

  it('ignores scroll when still at the top of the list', async () => {
    loadMore.mockClear();
    const { container } = render(<ThreadListContainer />);
    const viewport = container.querySelector('[data-slot="aui_thread-list-viewport"]');

    Object.defineProperty(viewport, 'scrollTop', { configurable: true, value: 0 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 800 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 200 });
    fireEvent.scroll(viewport!);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('ignores scroll when not near the bottom', async () => {
    loadMore.mockClear();
    const { container } = render(<ThreadListContainer />);
    const viewport = container.querySelector('[data-slot="aui_thread-list-viewport"]');

    Object.defineProperty(viewport, 'scrollTop', { configurable: true, value: 50 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 800 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 200 });
    fireEvent.scroll(viewport!);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loadMore).not.toHaveBeenCalled();
  });
});
