// @vitest-environment jsdom
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ExternalStoreThreadListAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ThreadListRowProps } from '@/atoms/ThreadListRow.js';
import { CompactLayoutProvider } from '@/atoms/lib/CompactLayoutContext.js';
import { ThreadListContainer } from '@/containers/ThreadListContainer.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import type { PermissionsServer } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

function ThreadListRuntimeHarness({
  threadList,
  children,
}: {
  threadList: ExternalStoreThreadListAdapter;
  children: ReactNode;
}) {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: [],
    convertMessage: message => message,
    onNew: async () => {},
    adapters: { threadList },
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

function ThreadListRowOverride({ title, active, onSelect, actions }: ThreadListRowProps) {
  return (
    <div data-testid={`thread-row-${title}`} data-active={active ? 'true' : 'false'}>
      <button type="button" onClick={onSelect}>
        {title}
      </button>
      {actions}
    </div>
  );
}

function renderThreadList({
  adapter,
  onThreadOpen,
  canDelete = false,
  permissions,
}: {
  adapter: ExternalStoreThreadListAdapter;
  onThreadOpen?: () => void;
  canDelete?: boolean;
  permissions?: PermissionsServer;
}) {
  const list = (
    <SlotsProvider overrides={{ ThreadListRow: ThreadListRowOverride }}>
      <ThreadListRuntimeHarness threadList={adapter}>
        <CompactLayoutProvider>
          <ThreadListContainer onThreadOpen={onThreadOpen} />
        </CompactLayoutProvider>
      </ThreadListRuntimeHarness>
    </SlotsProvider>
  );

  if (!canDelete) {
    return render(list);
  }

  return render(
    <ServerProvider
      server={createMockAgentUIServer({
        deleteSession: async () => {},
        ...(permissions === undefined ? {} : { permissions }),
      })}
    >
      {list}
    </ServerProvider>,
  );
}

describe('ThreadListContainer', () => {
  it('renders loading and empty list states from the runtime', () => {
    const { unmount } = renderThreadList({
      adapter: {
        isLoading: true,
        threads: [],
      },
    });

    expect(screen.getByRole('status', { name: 'Loading threads' })).toBeInTheDocument();
    unmount();

    renderThreadList({
      adapter: {
        isLoading: false,
        threads: [],
      },
    });

    expect(screen.getByText('No threads yet')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading threads' })).not.toBeInTheDocument();
  });

  it('starts a new chat and selects a row through the thread-list API', async () => {
    const onSwitchToNewThread = vi.fn(async () => {});
    const onSwitchToThread = vi.fn(async () => {});
    const onThreadOpen = vi.fn();

    renderThreadList({
      adapter: {
        threadId: 'thread-1',
        threads: [
          {
            status: 'regular',
            id: 'thread-1',
            title: 'Current session',
          },
          {
            status: 'regular',
            id: 'thread-2',
            title: 'Previous session',
          },
        ],
        onSwitchToNewThread,
        onSwitchToThread,
      },
      onThreadOpen,
    });

    expect(screen.getByTestId('thread-row-Current session')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('thread-row-Previous session')).toHaveAttribute('data-active', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Previous session' }));
    await waitFor(() => {
      expect(onSwitchToThread).toHaveBeenCalledWith('thread-2');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start new chat' }));
    await waitFor(() => {
      expect(onSwitchToNewThread).toHaveBeenCalledTimes(1);
    });
    expect(onThreadOpen).toHaveBeenCalledTimes(2);
  });

  it('exposes delete only for remote sessions and delegates deletion to the runtime', async () => {
    const onDelete = vi.fn(async () => {});

    renderThreadList({
      adapter: {
        threadId: 'thread-1',
        threads: [
          {
            status: 'regular',
            id: 'thread-1',
            remoteId: 'session-1',
            title: 'Remote session',
          },
          {
            status: 'regular',
            id: 'thread-local',
            title: 'Local draft',
          },
        ],
        onDelete,
      },
      canDelete: true,
    });

    const actionButtons = screen.getAllByRole('button', { name: 'Session actions' });
    expect(actionButtons).toHaveLength(1);
    const actionButton = actionButtons[0];
    if (actionButton === undefined) {
      throw new Error('Expected session actions button');
    }
    fireEvent.click(actionButton);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('thread-1');
    });
  });

  it('keeps session delete visible and disabled when DELETE is denied', async () => {
    const onDelete = vi.fn(async () => {});
    renderThreadList({
      adapter: {
        threadId: 'thread-1',
        threads: [{ status: 'regular', id: 'thread-1', remoteId: 'session-1', title: 'Remote session' }],
        onDelete,
      },
      canDelete: true,
      permissions: {
        listPermissions: vi.fn(async () => ({ data: { 'session-1': [] } })),
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Session actions' }));
    const deleteAction = screen.getByRole('button', { name: 'Delete' });
    expect(deleteAction).toBeDisabled();
    fireEvent.click(deleteAction);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('clears chat selection highlight while a sidebar top nav tab is open', () => {
    function OpenSchedulesButton() {
      const shell = useShellMode();
      return (
        <button type="button" onClick={() => shell.setSchedulesOpen(true)}>
          Open schedules tab
        </button>
      );
    }

    const server = createMockAgentUIServer({
      schedules: {
        listSchedules: vi.fn(async () => ({ data: [] })),
        getSchedule: vi.fn(),
        createSchedule: vi.fn(),
        updateSchedule: vi.fn(),
        deleteSchedule: vi.fn(),
        listScheduleRuns: vi.fn(async () => []),
        createScheduleRun: vi.fn(),
      },
    });

    render(
      <ServerProvider server={server}>
        <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>
          <SlotsProvider overrides={{ ThreadListRow: ThreadListRowOverride }}>
            <ThreadListRuntimeHarness
              threadList={{
                threadId: 'thread-1',
                threads: [
                  {
                    status: 'regular',
                    id: 'thread-1',
                    title: 'Current session',
                  },
                ],
              }}
            >
              <CompactLayoutProvider>
                <OpenSchedulesButton />
                <ThreadListContainer />
              </CompactLayoutProvider>
            </ThreadListRuntimeHarness>
          </SlotsProvider>
        </ShellModeProvider>
      </ServerProvider>,
    );

    expect(screen.getByTestId('thread-row-Current session')).toHaveAttribute('data-active', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Open schedules tab' }));
    expect(screen.getByTestId('thread-row-Current session')).toHaveAttribute('data-active', 'false');
  });
});
