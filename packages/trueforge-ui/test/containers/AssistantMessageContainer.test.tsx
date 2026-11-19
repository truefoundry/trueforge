// @vitest-environment jsdom
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { render, screen } from '@testing-library/react';
import {
  CANCELLATION_REASON_CUSTOM_KEY,
  TURN_CANCELLATION_REASON,
  trueForgeExtras,
} from '@truefoundry/trueforge-assistant-ui-runtime';
import { describe, expect, it } from 'vitest';

import { AssistantMessageContainer } from '@/containers/AssistantMessageContainer.js';
import { SessionReplayContext } from '@/containers/sessionReplayContext.js';
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

function cancelledMessage(options: { reason: string; content?: ThreadMessageLike['content'] }): ThreadMessageLike {
  return {
    role: 'assistant',
    content: options.content ?? 'partial reply',
    status: { type: 'incomplete', reason: 'cancelled' },
    metadata: { custom: { [CANCELLATION_REASON_CUSTOM_KEY]: options.reason } },
  };
}

function renderAssistantMessage(
  messages: ThreadMessageLike[],
  options?: { isRunning?: boolean; sessionReplay?: boolean },
) {
  return render(
    <SessionReplayContext.Provider value={options?.sessionReplay === true}>
      <RuntimeHarness messages={messages} isRunning={options?.isRunning}>
        <ThreadPrimitive.Messages>{() => <AssistantMessageContainer />}</ThreadPrimitive.Messages>
      </RuntimeHarness>
    </SessionReplayContext.Provider>,
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

  it.each([
    [TURN_CANCELLATION_REASON.CLIENT_CANCELLED, 'You stopped this response'],
    [TURN_CANCELLATION_REASON.SERVER_EXECUTION_TIMEOUT, 'Response timed out'],
    [TURN_CANCELLATION_REASON.ABANDONED, 'Response was interrupted'],
  ])('shows why a %s turn stopped, even with no output', (reason, label) => {
    renderAssistantMessage([cancelledMessage({ reason, content: [] })]);
    expect(screen.getByRole('status')).toHaveTextContent(label);
  });

  it('falls back to the raw reason for unknown cancel reasons', () => {
    renderAssistantMessage([cancelledMessage({ reason: 'something-new' })]);
    expect(screen.getByRole('status')).toHaveTextContent('something-new');
  });

  it('hides a turn cancelled for the next turn in live chat', () => {
    const { container } = renderAssistantMessage([
      cancelledMessage({ reason: TURN_CANCELLATION_REASON.CANCELLED_FOR_NEXT_TURN, content: [] }),
    ]);
    expect(container.querySelector('[data-role="assistant"]')).not.toBeInTheDocument();
  });

  it('keeps partial output without a banner when cancelled for the next turn', () => {
    renderAssistantMessage([cancelledMessage({ reason: TURN_CANCELLATION_REASON.CANCELLED_FOR_NEXT_TURN })]);
    expect(screen.getByText('partial reply')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows cancelled-for-next-turn in session replay', () => {
    renderAssistantMessage(
      [cancelledMessage({ reason: TURN_CANCELLATION_REASON.CANCELLED_FOR_NEXT_TURN, content: [] })],
      { sessionReplay: true },
    );
    expect(screen.getByRole('status')).toHaveTextContent('Stopped for a newer message');
  });

  it('shows the error banner for a failed turn with no output', () => {
    renderAssistantMessage([
      { role: 'assistant', content: [], status: { type: 'incomplete', reason: 'error', error: 'model failed' } },
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent('model failed');
  });
});
