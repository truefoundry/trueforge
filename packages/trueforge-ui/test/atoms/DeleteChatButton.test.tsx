// @vitest-environment jsdom
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ExternalStoreThreadListAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeleteChatButton } from '@/atoms/DeleteChatButton.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

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

function renderDeleteButton({
  adapter,
  canDelete = true,
}: {
  adapter: ExternalStoreThreadListAdapter;
  canDelete?: boolean;
}) {
  const tree = (
    <SlotsProvider>
      <ServerProvider
        server={createMockAgentUIServer({
          ...(canDelete ? { deleteSession: async () => {} } : {}),
        })}
      >
        <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
          <ThreadListRuntimeHarness threadList={adapter}>
            <DeleteChatButton />
          </ThreadListRuntimeHarness>
        </ShellModeProvider>
      </ServerProvider>
    </SlotsProvider>
  );
  return render(tree);
}

describe('DeleteChatButton', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes the current remote chat after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onDelete = vi.fn(async () => {});

    renderDeleteButton({
      adapter: {
        threadId: 'thread-1',
        threads: [
          {
            status: 'regular',
            id: 'thread-1',
            remoteId: 'session-1',
            title: 'Current session',
          },
        ],
        onDelete,
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete chat' }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('thread-1');
    });
  });

  it('does not delete when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onDelete = vi.fn(async () => {});

    renderDeleteButton({
      adapter: {
        threadId: 'thread-1',
        threads: [
          {
            status: 'regular',
            id: 'thread-1',
            remoteId: 'session-1',
            title: 'Current session',
          },
        ],
        onDelete,
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete chat' }));

    expect(onDelete).not.toHaveBeenCalled();
  });

  it('is hidden without a persisted remote session or delete-capable server', () => {
    const adapter: ExternalStoreThreadListAdapter = {
      threadId: 'thread-1',
      threads: [
        {
          status: 'regular',
          id: 'thread-1',
          title: 'Local draft',
        },
      ],
    };

    const { rerender } = renderDeleteButton({ adapter });
    expect(screen.queryByRole('button', { name: 'Delete chat' })).not.toBeInTheDocument();

    rerender(
      <SlotsProvider>
        <ServerProvider server={createMockAgentUIServer()}>
          <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
            <ThreadListRuntimeHarness
              threadList={{
                threadId: 'thread-1',
                threads: [
                  {
                    status: 'regular',
                    id: 'thread-1',
                    remoteId: 'session-1',
                    title: 'Current session',
                  },
                ],
              }}
            >
              <DeleteChatButton />
            </ThreadListRuntimeHarness>
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Delete chat' })).not.toBeInTheDocument();
  });
});
