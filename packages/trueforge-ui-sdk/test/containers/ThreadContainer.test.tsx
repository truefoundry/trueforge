// @vitest-environment jsdom
import type { ThreadMessageLike } from '@assistant-ui/react';
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { isNewChatView, ThreadContainer } from '@/containers/ThreadContainer.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import { RuntimeHarness } from './RuntimeHarness.js';

function EditAgentBootstrap({ children }: { children: ReactNode }) {
  const shell = useShellMode();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    shell.selectLibraryAgent({
      isMutable: true,
      agentId: 'writer',
      agentName: 'writer',
      agentSpec: { model: { name: 'openai-main/gpt-4.1' } },
    });
  }, [shell]);
  return children;
}

function renderThread(
  messages: ThreadMessageLike[],
  options?: { isLoading?: boolean; composer?: React.ReactNode; agentName?: string; editAgent?: boolean },
) {
  const thread = (
    <RuntimeHarness messages={messages} isLoading={options?.isLoading}>
      <ThreadContainer composer={options?.composer} />
    </RuntimeHarness>
  );
  if (options?.editAgent) {
    return render(
      <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>
        <EditAgentBootstrap>{thread}</EditAgentBootstrap>
      </ShellModeProvider>,
    );
  }
  return render(
    options?.agentName != null ? (
      <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: options.agentName }}>{thread}</ShellModeProvider>
    ) : (
      thread
    ),
  );
}

function emptyThreadState(
  overrides: {
    isLoading?: boolean;
    threadsIsLoading?: boolean;
    remoteId?: string | undefined;
  } = {},
) {
  return {
    thread: {
      messages: [],
      isLoading: overrides.isLoading ?? false,
    },
    threads: {
      isLoading: overrides.threadsIsLoading ?? false,
    },
    threadListItem: {
      remoteId: overrides.remoteId,
    },
  };
}

describe('isNewChatView', () => {
  it('is true for a brand-new empty thread with no session', () => {
    expect(isNewChatView(emptyThreadState())).toBe(true);
  });

  it('is false while an established session briefly has zero messages (first-turn edit/retry rewind)', () => {
    expect(isNewChatView(emptyThreadState({ remoteId: 'sess-1' }))).toBe(false);
  });

  it('is false while thread history is loading (and threads list is idle)', () => {
    expect(isNewChatView(emptyThreadState({ isLoading: true }))).toBe(false);
  });
});

describe('ThreadContainer', () => {
  it('renders the welcome screen for a new, empty thread', () => {
    renderThread([]);
    expect(screen.getByText('How can I help you today?')).toBeInTheDocument();
  });

  it('shows the agent name on the empty named-agent welcome screen', () => {
    renderThread([], { agentName: 'support-agent' });
    expect(screen.getByText('support-agent')).toBeInTheDocument();
    expect(screen.queryByText('How can I help you today?')).not.toBeInTheDocument();
  });

  it('shows the agent name on the empty Edit-agent welcome screen', async () => {
    renderThread([], { editAgent: true });
    await waitFor(() => {
      expect(screen.getByText('writer')).toBeInTheDocument();
    });
    expect(screen.queryByText('How can I help you today?')).not.toBeInTheDocument();
  });

  it('renders the loading skeleton while thread history is loading', () => {
    renderThread([], { isLoading: true });
    expect(screen.getByRole('status', { name: 'Loading conversation' })).toBeInTheDocument();
    expect(screen.queryByText('How can I help you today?')).not.toBeInTheDocument();
  });

  it('renders the message list once loaded and non-empty', () => {
    renderThread([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello there' },
    ]);
    expect(screen.getByText('hello there')).toBeInTheDocument();
    expect(screen.queryByText('How can I help you today?')).not.toBeInTheDocument();
  });

  it('renders the supplied composer slot', () => {
    renderThread([{ role: 'user', content: 'hi' }], {
      composer: <div data-testid="composer-slot" />,
    });
    expect(screen.getByTestId('composer-slot')).toBeInTheDocument();
  });

  it('centers the composer in the viewport on an empty thread', () => {
    renderThread([], { composer: <div data-testid="composer-slot" /> });
    const composer = screen.getByTestId('composer-slot');
    expect(composer).toBeInTheDocument();
    expect(composer.closest('[data-slot="aui_thread-viewport"]')).not.toBeNull();
    expect(composer.closest('[data-slot="aui_thread-composer"]')).toBeNull();
  });

  it('omits the composer area entirely while loading', () => {
    renderThread([], { isLoading: true, composer: <div data-testid="composer-slot" /> });
    expect(screen.queryByTestId('composer-slot')).not.toBeInTheDocument();
  });
});
