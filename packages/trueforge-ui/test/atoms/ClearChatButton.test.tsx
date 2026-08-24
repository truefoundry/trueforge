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

import { ClearChatButton } from '@/atoms/ClearChatButton.js';
import { SelectAgentEmptyState } from '@/atoms/SelectAgentEmptyState.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { RuntimeHarness } from '../containers/RuntimeHarness.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({
    agentSpec: {
      model: { name: 'openai-main/gpt-4.1' },
    },
  }),
}));

const startedMessages = [{ role: 'user' as const, content: 'hello', id: 'm1' }];

function mockServer() {
  return createMockAgentUIServer({
    searchAgents: vi.fn(async () => [{ name: 'alpha', agentId: 'alpha' }]),
  });
}

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

describe('ClearChatButton', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is hidden while idle', () => {
    render(
      <SlotsProvider>
        <ShellModeProvider agentConfig={{ mode: 'AgentLibrary' }}>
          <RuntimeHarness messages={[]}>
            <ClearChatButton />
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Chat actions' })).not.toBeInTheDocument();
  });

  it('shows Clear chat in the actions menu for an empty named agent chat', () => {
    render(
      <SlotsProvider>
        <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'a' }}>
          <RuntimeHarness messages={[]}>
            <ClearChatButton />
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Chat actions' }));
    expect(screen.getByRole('menuitem', { name: 'Clear chat' })).toBeInTheDocument();
  });

  it('is hidden on mutable sessions without a persisted chat', () => {
    render(
      <SlotsProvider>
        <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
          <RuntimeHarness messages={startedMessages}>
            <ClearChatButton />
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Chat actions' })).not.toBeInTheDocument();
  });

  it('calls clearChat when clicked after a chat has started', () => {
    render(
      <SlotsProvider>
        <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'a' }}>
          <RuntimeHarness messages={startedMessages}>
            <ClearChatButton />
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Chat actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear chat' }));
  });

  it('groups Clear and Delete chat for a persisted mutable session', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onDelete = vi.fn(async () => {});

    render(
      <SlotsProvider>
        <ServerProvider server={createMockAgentUIServer({ deleteSession: async () => {} })}>
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
                onDelete,
              }}
            >
              <ClearChatButton />
            </ThreadListRuntimeHarness>
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Chat actions' }));
    expect(screen.getByRole('menuitem', { name: 'Clear chat' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete chat' }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('thread-1');
    });
  });
});

describe('SelectAgentEmptyState', () => {
  it('renders CTA when idle', () => {
    render(
      <SlotsProvider>
        <ServerProvider server={mockServer()}>
          <ShellModeProvider agentConfig={{ mode: 'AgentLibrary' }}>
            <SelectAgentEmptyState />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );
    expect(screen.getByText('Select an agent to start chatting')).toBeInTheDocument();
  });

  it('renders nothing when not idle', () => {
    render(
      <SlotsProvider>
        <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'a' }}>
          <SelectAgentEmptyState />
        </ShellModeProvider>
      </SlotsProvider>,
    );
    expect(screen.queryByText('Select an agent to start chatting')).not.toBeInTheDocument();
  });
});
