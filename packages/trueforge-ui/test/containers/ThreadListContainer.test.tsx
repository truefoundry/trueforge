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
import { ThreadListContainer, type ThreadListContainerProps } from '@/containers/ThreadListContainer.js';
import { ToasterProvider } from '@/containers/ToasterContainer.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import type { ListPermissionsResponse } from '@/server/types.js';
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

function TryAgentButton() {
  const shell = useShellMode();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          shell.selectLibraryAgent({
            isMutable: false,
            agentId: 'support-id',
            agentName: 'Support Agent',
          })
        }
      >
        Try Support Agent
      </button>
      <button
        type="button"
        onClick={() =>
          shell.openHistorySession({
            sessionId: 'support-session',
            isMutable: false,
            agentName: 'Support Agent',
          })
        }
      >
        Open Support Session
      </button>
      <button
        type="button"
        onClick={() => {
          shell.setHistoryAgentFilter({
            agentId: 'support-id',
            agentName: 'Support Agent',
            intent: 'history',
          });
          shell.openHistorySession({
            sessionId: 'filtered-support-session',
            isMutable: false,
            agentName: 'Support Agent',
          });
        }}
      >
        Open Filtered Support Session
      </button>
    </>
  );
}

function renderThreadList({
  adapter,
  onThreadOpen,
  canDelete = false,
  canRename = false,
  permissions,
  variant,
}: {
  adapter: ExternalStoreThreadListAdapter;
  onThreadOpen?: () => void;
  canDelete?: boolean;
  canRename?: boolean;
  permissions?: {
    listPermissions: (req: { resourceType: string; resourceIds: string[] }) => Promise<ListPermissionsResponse>;
  };
  variant?: ThreadListContainerProps['variant'];
}) {
  const list = (
    <SlotsProvider overrides={{ ThreadListRow: ThreadListRowOverride }}>
      <ToasterProvider>
        <ThreadListRuntimeHarness threadList={adapter}>
          <CompactLayoutProvider>
            <ThreadListContainer onThreadOpen={onThreadOpen} variant={variant} />
          </CompactLayoutProvider>
        </ThreadListRuntimeHarness>
      </ToasterProvider>
    </SlotsProvider>
  );

  if (!canDelete && !canRename) {
    return render(list);
  }

  return render(
    <ServerProvider
      server={createMockAgentUIServer({
        ...(canDelete ? { deleteSession: async () => {} } : {}),
        ...(canRename ? { renameSession: async () => {} } : {}),
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

  it('shows persisted draft and named sessions in recent-history mode', () => {
    const { container } = renderThreadList({
      adapter: {
        threadId: 'draft-1',
        threads: [
          {
            status: 'regular',
            id: 'draft-1',
            remoteId: 'session-draft-1',
            title: 'Draft chat',
            custom: { isMutable: true },
          },
          {
            status: 'regular',
            id: 'named-1',
            remoteId: 'session-named-1',
            title: 'Named chat',
            custom: { isMutable: false },
          },
          {
            status: 'regular',
            id: 'local-draft',
            title: 'Unsaved chat',
            custom: { isMutable: true },
          },
        ],
      },
      variant: 'recent-history',
    });

    expect(screen.getByRole('button', { name: 'Draft chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Named chat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unsaved chat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start new chat' })).not.toBeInTheDocument();
    expect(screen.queryByText('New Chat')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chat History' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chat History' })).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="aui_thread-list-viewport"]')).toHaveClass('aui-scrollbar-hidden');
  });

  it('uses filter intent to distinguish Try Agent from a filtered agent session', () => {
    const server = createMockAgentUIServer({
      searchAgents: async () => [{ name: 'Support Agent', agentId: 'support-id' }],
    });

    render(
      <ServerProvider server={server}>
        <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>
          <SlotsProvider overrides={{ ThreadListRow: ThreadListRowOverride }}>
            <ThreadListRuntimeHarness threadList={{ threads: [] }}>
              <CompactLayoutProvider>
                <TryAgentButton />
                <ThreadListContainer variant="recent-history" />
              </CompactLayoutProvider>
            </ThreadListRuntimeHarness>
          </SlotsProvider>
        </ShellModeProvider>
      </ServerProvider>,
    );

    expect(screen.getByRole('button', { name: 'Filter chat history by agent' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Support Agent' }));

    expect(screen.getByRole('heading', { name: 'Chats for Support Agent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Filter chat history by agent/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Support Session' }));
    expect(screen.queryByRole('button', { name: /Filter chat history by agent/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Filtered Support Session' }));
    expect(screen.getByRole('button', { name: /Filter chat history by agent/ })).toBeInTheDocument();
  });

  it('shows the recent-history empty state when only an unsaved session exists', () => {
    renderThreadList({
      adapter: {
        threads: [
          {
            status: 'regular',
            id: 'local-draft',
            title: 'Unsaved chat',
            custom: { isMutable: true },
          },
        ],
      },
      variant: 'recent-history',
    });

    expect(screen.getByText('No recent chats')).toBeInTheDocument();
  });

  it('loads a named history session without leaving the recent list', async () => {
    function ActiveMode() {
      const shell = useShellMode();
      const name = shell.mode.status === 'active' ? shell.mode.agentName : undefined;
      return <output aria-label="Active agent">{name ?? 'draft'}</output>;
    }

    render(
      <SlotsProvider overrides={{ ThreadListRow: ThreadListRowOverride }}>
        <ServerProvider server={createMockAgentUIServer()}>
          <ShellModeProvider>
            <ThreadListRuntimeHarness
              threadList={{
                threads: [
                  {
                    status: 'regular',
                    id: 'named-1',
                    remoteId: 'session-named-1',
                    title: 'Named chat',
                    custom: { isMutable: false, agentName: 'named-agent' },
                  },
                ],
              }}
            >
              <CompactLayoutProvider>
                <ActiveMode />
                <ThreadListContainer variant="recent-history" />
              </CompactLayoutProvider>
            </ThreadListRuntimeHarness>
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Named chat' }));

    await waitFor(() => expect(screen.getByRole('status', { name: 'Active agent' })).toHaveTextContent('named-agent'));
    expect(screen.getByRole('heading', { name: 'Chat History' })).toBeInTheDocument();
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

  it('hides rename when the server does not opt in', () => {
    renderThreadList({
      adapter: {
        threads: [
          {
            status: 'regular',
            id: 'thread-1',
            remoteId: 'session-1',
            title: 'Remote session',
          },
        ],
      },
      canDelete: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('renames a remote session from the modal after validating the title', async () => {
    const onRename = vi.fn(async () => {});

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
        onRename,
      },
      canRename: true,
    });

    const actionButtons = screen.getAllByRole('button', { name: 'Session actions' });
    expect(actionButtons).toHaveLength(1);
    fireEvent.click(actionButtons[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    const dialog = screen.getByRole('dialog', { name: 'Rename session' });
    expect(dialog).toBeInTheDocument();
    const titleInput = screen.getByRole('textbox', { name: 'Session title' });
    expect(titleInput).toHaveValue('Remote session');

    fireEvent.change(titleInput, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.change(titleInput, { target: { value: '  Acme onboarding  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('thread-1', 'Acme onboarding');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Rename session' })).not.toBeInTheDocument();
    });
  });

  it('cancels rename from the modal without persisting', async () => {
    const onRename = vi.fn(async () => {});

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
        ],
        onRename,
      },
      canRename: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const titleInput = screen.getByRole('textbox', { name: 'Session title' });
    fireEvent.change(titleInput, { target: { value: 'Scratch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Rename session' })).not.toBeInTheDocument();
    });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText('Remote session')).toBeInTheDocument();
  });

  it('keeps the modal open and disables Cancel while rename is saving', async () => {
    let resolveRename: (() => void) | undefined;
    const onRename = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveRename = resolve;
        }),
    );

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
        ],
        onRename,
      },
      canRename: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const titleInput = screen.getByRole('textbox', { name: 'Session title' });
    fireEvent.change(titleInput, { target: { value: 'Updated title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(titleInput).toHaveAttribute('readonly');
    });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Rename session' })).toBeInTheDocument();

    resolveRename?.();
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Rename session' })).not.toBeInTheDocument();
    });
  });

  it('toasts when rename fails and keeps the modal open', async () => {
    const onRename = vi.fn(async () => {
      throw new Error('rename failed');
    });

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
        ],
        onRename,
      },
      canRename: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const titleInput = screen.getByRole('textbox', { name: 'Session title' });
    fireEvent.change(titleInput, { target: { value: 'Updated title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('rename failed')).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog', { name: 'Rename session' })).toBeInTheDocument();
    expect(onRename).toHaveBeenCalledOnce();
  });

  it('disables rename when the caller lacks MANAGE', async () => {
    renderThreadList({
      adapter: {
        threads: [
          {
            status: 'regular',
            id: 'thread-1',
            remoteId: 'session-1',
            title: 'Remote session',
          },
        ],
      },
      canRename: true,
      canDelete: true,
      permissions: {
        listPermissions: vi.fn(async (): Promise<ListPermissionsResponse> => ({
          data: { type: 'session', permissions: { 'session-1': ['DELETE'] } },
        })),
      },
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Session actions' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled();
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
