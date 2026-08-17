// @vitest-environment jsdom
import { ThreadPrimitive, type ThreadMessageLike } from '@assistant-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCallback } from 'react';
import { describe, expect, it } from 'vitest';

import type { AgentStepsCardProps } from '@/atoms/adapters/AgentStepsCardAdapter.js';
import type { ReasoningCardProps } from '@/atoms/adapters/ReasoningCardAdapter.js';
import { AssistantMessageContainer } from '@/containers/AssistantMessageContainer.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { RuntimeHarness } from './RuntimeHarness.js';

function AgentStepsCardProbe({ children }: AgentStepsCardProps) {
  return <div>{children}</div>;
}

function ReasoningCardProbe({
  content,
  isStreaming,
  expanded,
  isMultiLine,
  reasoningTimeText,
  previewText,
  headingText,
  contentRef,
  onToggle,
}: ReasoningCardProps) {
  const measuredContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node !== null) {
        Object.defineProperty(node, 'scrollHeight', { configurable: true, value: 80 });
      }
      contentRef?.(node);
    },
    [contentRef],
  );

  return (
    <section
      data-testid="reasoning-probe"
      data-content={content}
      data-streaming={String(isStreaming)}
      data-expanded={String(expanded)}
      data-multiline={String(isMultiLine)}
      data-reasoning-time={String(reasoningTimeText)}
      data-preview={previewText}
      data-heading={headingText}
    >
      <button type="button" onClick={onToggle}>
        Toggle reasoning
      </button>
      <div ref={measuredContentRef}>measured reasoning</div>
    </section>
  );
}

function TestSubject({ message, isRunning = false }: { message: ThreadMessageLike; isRunning?: boolean }) {
  return (
    <RuntimeHarness messages={[message]} isRunning={isRunning}>
      <SlotsProvider
        overrides={{
          AgentStepsCard: AgentStepsCardProbe,
          ReasoningCard: ReasoningCardProbe,
        }}
      >
        <ThreadPrimitive.Messages>{() => <AssistantMessageContainer />}</ThreadPrimitive.Messages>
      </SlotsProvider>
    </RuntimeHarness>
  );
}

describe('ReasoningContainer', () => {
  it('joins grouped reasoning, normalizes its preview, and measures multiline content', async () => {
    render(
      <TestSubject
        message={{
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'First line\n' },
            { type: 'reasoning', text: '  second line' },
          ],
        }}
      />,
    );

    const probe = screen.getByTestId('reasoning-probe');
    expect(probe).toHaveAttribute('data-content', 'First line\n  second line');
    expect(probe).toHaveAttribute('data-preview', 'First line second line');
    expect(probe).toHaveAttribute('data-streaming', 'false');
    expect(probe).toHaveAttribute('data-expanded', 'false');
    expect(probe).toHaveAttribute('data-heading', 'Reasoning');
    expect(probe).toHaveAttribute('data-reasoning-time', 'null');
    await waitFor(() => {
      expect(probe).toHaveAttribute('data-multiline', 'true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle reasoning' }));
    expect(probe).toHaveAttribute('data-expanded', 'true');
  });

  it('starts expanded while streaming and re-expands when streaming resumes', async () => {
    const completedMessage: ThreadMessageLike = {
      role: 'assistant',
      content: [{ type: 'reasoning', text: 'Thinking' }],
    };
    const runningMessage: ThreadMessageLike = {
      role: 'assistant',
      content: [{ type: 'reasoning', text: 'Thinking further' }],
      status: { type: 'running' },
    };
    const { rerender } = render(<TestSubject message={runningMessage} isRunning />);

    const probe = screen.getByTestId('reasoning-probe');
    expect(probe).toHaveAttribute('data-streaming', 'true');
    expect(probe).toHaveAttribute('data-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle reasoning' }));
    expect(probe).toHaveAttribute('data-expanded', 'false');

    rerender(<TestSubject message={completedMessage} />);
    await waitFor(() => {
      expect(screen.getByTestId('reasoning-probe')).toHaveAttribute('data-streaming', 'false');
    });
    expect(screen.getByTestId('reasoning-probe')).toHaveAttribute('data-expanded', 'false');

    rerender(<TestSubject message={runningMessage} isRunning />);
    await waitFor(() => {
      expect(screen.getByTestId('reasoning-probe')).toHaveAttribute('data-streaming', 'true');
      expect(screen.getByTestId('reasoning-probe')).toHaveAttribute('data-expanded', 'true');
    });
  });
});
