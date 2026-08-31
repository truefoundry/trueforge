// @vitest-environment jsdom
import { useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createMockAgentSessionsServer, createMockAgentUIServer } from '../server/mockServer.js';

/** Thread list driven by the test: a local draft plus one remote session row. */
const threadState = {
  threadId: 'thread-draft',
  setThreadId: (_id: string) => {},
};

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  trueFoundryAttachmentAdapter: {},
  useTrueFoundryAgentRuntime: () => {
    const [threadId, setThreadId] = useState(threadState.threadId);
    threadState.setThreadId = setThreadId;
    return useExternalStoreRuntime<ThreadMessageLike>({
      messages: [],
      isRunning: false,
      convertMessage: (message: ThreadMessageLike) => message,
      onNew: async () => {},
      adapters: {
        threadList: {
          threadId,
          threads: [
            { status: 'regular', id: 'thread-draft', title: 'New Chat' },
            { status: 'regular', id: 'thread-2', remoteId: 'session-2', title: 'Second' },
          ],
          onSwitchToThread: async id => {
            setThreadId(id);
          },
        },
      },
    });
  },
  useTrueFoundryCancel: () => vi.fn(),
  useTrueFoundryToolResponses: () => ({ pending: [] }),
  useTrueFoundryRespondToToolApproval: () => vi.fn(),
  useTrueFoundryMcpAuth: () => ({ pending: [], connect: vi.fn(), continue: vi.fn() }),
  useTrueFoundryHistoryPagination: () => ({
    isLoadingMore: false,
    hasMore: false,
    loadMore: vi.fn(),
  }),
  useTrueFoundryAgentSpec: () => ({
    agentSpec: { model: { name: 'openai-main/gpt-4.1' } },
  }),
  useTrueFoundryFlushAgentSpec: () => async () => {},
  useTrueFoundryAdoptAgentSpec: () => vi.fn(),
  useTrueFoundryUpdateAgentSpec: () => vi.fn(),
}));

import { CompactLayoutProvider } from '@/atoms/lib/CompactLayoutContext.js';
import { SessionsBrowserButton } from '@/atoms/SessionsBrowserButton.js';
import type { ThreadListRowProps } from '@/atoms/ThreadListRow.js';
import { ThreadListContainer } from '@/containers/ThreadListContainer.js';
import { TrueForgeUI } from '@/containers/TrueForgeUI.js';
import { useShellMode } from '@/server/ShellModeContext.js';
import { DEFAULT_SESSION_TIME_WINDOW_MS } from '@/utils/sessionShareUrl.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

function ThreadListRowOverride({ title, onSelect }: ThreadListRowProps) {
  return (
    <button type="button" onClick={onSelect}>
      {title}
    </button>
  );
}

/** Exposes shell state so boot behaviour is observable from the DOM. */
function ShellProbe() {
  const shell = useShellMode();
  const mode = shell.mode;
  return (
    <>
      <div data-testid="pending">{shell.pendingSessionId ?? 'none'}</div>
      <div data-testid="binding">
        {mode.status === 'idle' ? 'idle' : `${mode.isMutable ? 'mutable' : 'immutable'}:${mode.agentName ?? '-'}`}
      </div>
    </>
  );
}

function ThreadListHost() {
  return (
    <CompactLayoutProvider>
      <ThreadListContainer />
    </CompactLayoutProvider>
  );
}

function renderApp() {
  return render(
    <TrueForgeUI
      server={createMockAgentUIServer({})}
      agentConfig={{ mode: 'AgentLibraryWithComposer' }}
      withRouter
      layout={() => <ShellProbe />}
      overrides={{ ThreadListRow: ThreadListRowOverride }}
    />,
  );
}

describe('withRouter end to end', () => {
  it('applies a /sessions/:id deep link on boot', async () => {
    window.history.replaceState(null, '', '/sessions/session-2');
    renderApp();

    await waitFor(() => {
      expect(screen.getByTestId('pending')).toHaveTextContent('session-2');
    });
    expect(window.location.pathname).toBe('/sessions/session-2');
  });

  // A URL carries only an id, so the session's own identity must decide the
  // chrome; assuming "mutable draft" turns an agent chat into a blank one.
  it('binds a deep-linked agent session to that agent', async () => {
    window.history.replaceState(null, '', '/sessions/session-agent');
    render(
      <TrueForgeUI
        server={createMockAgentUIServer({
          getSession: async () => ({
            id: 'session-agent',
            title: 'Agent chat',
            agentName: 'my-agent',
            isMutable: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          }),
        })}
        agentConfig={{ mode: 'AgentLibraryWithComposer' }}
        withRouter
        layout={() => <ShellProbe />}
        overrides={{ ThreadListRow: ThreadListRowOverride }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('binding')).toHaveTextContent('immutable:my-agent');
    });
    expect(screen.getByTestId('pending')).toHaveTextContent('session-agent');
    expect(window.location.pathname).toBe('/sessions/session-agent');
  });

  it('pushes /sessions/:id when a history row is picked', async () => {
    render(
      <TrueForgeUI
        server={createMockAgentUIServer({})}
        agentConfig={{ mode: 'AgentLibraryWithComposer' }}
        withRouter
        layout={() => (
          <>
            <ShellProbe />
            <ThreadListHost />
          </>
        )}
        overrides={{ ThreadListRow: ThreadListRowOverride }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Second' })).toBeInTheDocument();
    });
    expect(window.location.pathname).toBe('/');

    fireEvent.click(screen.getByRole('button', { name: 'Second' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/sessions/session-2');
    });
  });

  it('keeps the latest share query when opening Sessions from an agent route', async () => {
    window.history.replaceState(null, '', '/library/agent-1?agentId=agent-1&sessionId=stale&s_sts=1&s_ets=2');
    render(
      <TrueForgeUI
        server={createMockAgentUIServer({ sessions: createMockAgentSessionsServer() })}
        agentConfig={{ mode: 'AgentLibraryWithComposer' }}
        withRouter
        layout={() => <SessionsBrowserButton />}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Sessions' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/sessions');
      const params = new URL(window.location.href).searchParams;
      expect(params.get('view')).toBe('sessions');
      expect(params.get('sessionId')).toBeNull();
      expect(params.get('agentId')).toBeNull();
      expect(params.get('s_tw')).toBe(String(DEFAULT_SESSION_TIME_WINDOW_MS));
      expect(params.get('s_sts')).toBeNull();
      expect(params.get('s_ets')).toBeNull();
    });
  });
});
