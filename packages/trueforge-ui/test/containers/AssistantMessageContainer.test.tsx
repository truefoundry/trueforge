// @vitest-environment jsdom
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { render, screen } from '@testing-library/react';
import { trueForgeExtras } from '@truefoundry/trueforge-assistant-ui-runtime';
import { describe, expect, it } from 'vitest';

import { AssistantMessageContainer } from '@/containers/AssistantMessageContainer.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { RuntimeHarness } from './RuntimeHarness.js';

const runningToolCallMessage: ThreadMessageLike = {
  role: 'assistant',
  content: [
    {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: {},
      argsText: '{}',
    },
  ],
  status: { type: 'running' },
};

function renderAssistantMessage(messages: ThreadMessageLike[], options?: { isRunning?: boolean }) {
  return render(
    <RuntimeHarness messages={messages} isRunning={options?.isRunning}>
      <ThreadPrimitive.Messages>{() => <AssistantMessageContainer />}</ThreadPrimitive.Messages>
    </RuntimeHarness>,
  );
}

function renderAssistantMessageWithExtras(
  messages: ThreadMessageLike[],
  options: { isRunning: boolean; resumeUnavailable: boolean },
) {
  function Harness() {
    const runtime = useExternalStoreRuntime({
      messages,
      isRunning: options.isRunning,
      convertMessage: (message: ThreadMessageLike) => message,
      onNew: async () => {},
      extras: trueForgeExtras.provide({
        pendingApprovals: [],
        pendingToolResponses: [],
        pendingMcpAuth: null,
        resumeUnavailable: options.resumeUnavailable,
        sandboxId: undefined,
        respondToToolApproval: async () => {},
        respondToToolResponse: async () => {},
        continueMcpAuth: async () => {},
        downloadSandboxFile: async () => new Blob(),
        cancel: async () => {},
        resetFromTurn: async () => {},
        reload: () => {},
        hasOlderHistory: false,
        isLoadingOlderHistory: false,
        loadOlderHistory: async () => {},
        draft: null,
      }),
    });
    return (
      <AssistantRuntimeProvider runtime={runtime}>
        <SlotsProvider>
          <ThreadPrimitive.Messages>{() => <AssistantMessageContainer />}</ThreadPrimitive.Messages>
        </SlotsProvider>
      </AssistantRuntimeProvider>
    );
  }
  return render(<Harness />);
}

describe('AssistantMessageContainer', () => {
  it('renders assistant text through the Markdown atom', () => {
    renderAssistantMessage([{ role: 'assistant', content: 'hello world' }]);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('passes the message error to MessageErrorBanner when the message failed', () => {
    renderAssistantMessage([
      {
        role: 'assistant',
        content: 'partial',
        status: { type: 'incomplete', reason: 'error', error: 'boom' },
      },
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  it('does not render an error banner for a healthy message', () => {
    renderAssistantMessage([{ role: 'assistant', content: 'all good' }]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides the action bar while the thread is running (streaming state)', () => {
    renderAssistantMessage([{ role: 'assistant', content: 'typing...' }], { isRunning: true });
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });

  it('shows the action bar once the thread is idle', () => {
    renderAssistantMessage(
      [
        {
          role: 'assistant',
          content: 'done',
          createdAt: new Date('2026-07-09T14:06:04'),
        },
      ],
      { isRunning: false },
    );
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByText(/\d{1,2}:\d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('hides the branch indicator when there is only a single branch', () => {
    renderAssistantMessage([{ role: 'assistant', content: 'hi' }]);
    expect(screen.queryByText(/^\d+ \/ \d+$/)).not.toBeInTheDocument();
  });

  it('shows the activity indicator while the thread and message are running', () => {
    renderAssistantMessageWithExtras([runningToolCallMessage], {
      isRunning: true,
      resumeUnavailable: false,
    });
    expect(screen.getByRole('status')).toHaveTextContent(/Working/);
  });

  it('hides the activity indicator when the thread is idle even if the message status is still running', () => {
    // Stale tip after cancel without a subscribe stream: isRunning cleared but
    // message status can lag until the snapshot is finalized.
    renderAssistantMessageWithExtras([runningToolCallMessage], {
      isRunning: false,
      resumeUnavailable: false,
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('hides the activity indicator when resume is unavailable', () => {
    renderAssistantMessageWithExtras([runningToolCallMessage], {
      isRunning: true,
      resumeUnavailable: true,
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
