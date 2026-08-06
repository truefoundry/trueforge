// @vitest-environment jsdom
import type { AssistantState, ThreadMessageLike } from '@assistant-ui/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ShellModeProvider } from '../server/ShellModeContext.js';
import { RuntimeHarness } from './RuntimeHarness.js';
import { isNewChatView, ThreadContainer } from './ThreadContainer.js';

function renderThread(
  messages: ThreadMessageLike[],
  options?: { isLoading?: boolean; composer?: React.ReactNode; agentName?: string },
) {
  const thread = (
    <RuntimeHarness messages={messages} isLoading={options?.isLoading}>
      <ThreadContainer composer={options?.composer} />
    </RuntimeHarness>
  );
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
): AssistantState {
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
  } as unknown as AssistantState;
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
