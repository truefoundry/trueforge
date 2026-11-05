// @vitest-environment jsdom
import { ThreadPrimitive, type ThreadMessageLike } from '@assistant-ui/react';
import { render, screen } from '@testing-library/react';
import { CANCELLATION_REASON_CUSTOM_KEY } from '@truefoundry/trueforge-assistant-ui-runtime';
import { describe, expect, it } from 'vitest';

import { AssistantMessageContainer } from '@/containers/AssistantMessageContainer.js';
import { SessionReplayContext } from '@/containers/sessionReplayContext.js';
import { RuntimeHarness } from './RuntimeHarness.js';

function cancelledMessage(options?: { content?: ThreadMessageLike['content']; reason?: string }): ThreadMessageLike {
  return {
    role: 'assistant',
    content: options?.content ?? 'partial reply',
    status: { type: 'incomplete', reason: 'cancelled' },
    metadata: {
      custom: { [CANCELLATION_REASON_CUSTOM_KEY]: options?.reason ?? 'Superseded by a later message' },
    },
  };
}

function renderAssistantMessage(
  messages: ThreadMessageLike[],
  options?: { isRunning?: boolean; sessionReplay?: boolean },
) {
  const tree = (
    <RuntimeHarness messages={messages} isRunning={options?.isRunning}>
      <ThreadPrimitive.Messages>{() => <AssistantMessageContainer />}</ThreadPrimitive.Messages>
    </RuntimeHarness>
  );
  return render(
    options?.sessionReplay === true ? (
      <SessionReplayContext.Provider value={true}>{tree}</SessionReplayContext.Provider>
    ) : (
      tree
    ),
  );
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

  it('hides the cancel-reason banner in live chat', () => {
    renderAssistantMessage([cancelledMessage()]);
    expect(screen.getByText('partial reply')).toBeInTheDocument();
    expect(screen.queryByText('Superseded by a later message')).not.toBeInTheDocument();
  });

  it('shows the cancel-reason banner in session-detail replay', () => {
    renderAssistantMessage([cancelledMessage()], { sessionReplay: true });
    expect(screen.getByText('partial reply')).toBeInTheDocument();
    expect(screen.getByText('Superseded by a later message')).toBeInTheDocument();
  });

  it('omits an empty cancelled assistant bubble in live chat', () => {
    const { container } = renderAssistantMessage([cancelledMessage({ content: [] })]);
    expect(container.querySelector('[data-role="assistant"]')).not.toBeInTheDocument();
    expect(screen.queryByText('Superseded by a later message')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });
});
