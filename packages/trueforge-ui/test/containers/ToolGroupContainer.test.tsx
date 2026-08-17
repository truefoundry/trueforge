// @vitest-environment jsdom
import { ThreadPrimitive, type ThreadMessageLike } from '@assistant-ui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AssistantMessageContainer } from '@/containers/AssistantMessageContainer.js';
import { RuntimeHarness } from './RuntimeHarness.js';

function renderMultiToolMessage(content: ThreadMessageLike['content'], isRunning = false) {
  const message: ThreadMessageLike = { role: 'assistant', content };
  return render(
    <RuntimeHarness messages={[message]} isRunning={isRunning}>
      <ThreadPrimitive.Messages>{() => <AssistantMessageContainer />}</ThreadPrimitive.Messages>
    </RuntimeHarness>,
  );
}

describe('AgentSteps grouping', () => {
  it('groups consecutive tool calls under the Agent steps accordion', () => {
    renderMultiToolMessage([
      { type: 'tool-call', toolCallId: '1', toolName: 'first_tool', args: {}, result: 'a' },
      { type: 'tool-call', toolCallId: '2', toolName: 'second_tool', args: {}, result: 'b' },
    ]);
    expect(screen.getByText('Agent steps')).toBeInTheDocument();
    expect(screen.getByText(/2 tool calls/)).toBeInTheDocument();
  });

  it('renders both nested tool calls once expanded (defaultOpen)', () => {
    renderMultiToolMessage([
      { type: 'tool-call', toolCallId: '1', toolName: 'first_tool', args: {} },
      { type: 'tool-call', toolCallId: '2', toolName: 'second_tool', args: {} },
    ]);
    expect(screen.getByText('first_tool')).toBeInTheDocument();
    expect(screen.getByText('second_tool')).toBeInTheDocument();
  });

  it('collapses the group when the trigger is toggled', () => {
    renderMultiToolMessage([
      { type: 'tool-call', toolCallId: '1', toolName: 'first_tool', args: {} },
      { type: 'tool-call', toolCallId: '2', toolName: 'second_tool', args: {} },
    ]);
    fireEvent.click(screen.getByText('Agent steps'));
    expect(screen.queryByText('first_tool')).not.toBeInTheDocument();
  });

  it('uses singular label for exactly one tool call in the group', () => {
    renderMultiToolMessage([{ type: 'tool-call', toolCallId: '1', toolName: 'first_tool', args: {} }]);
    expect(screen.getByText('Agent steps')).toBeInTheDocument();
    expect(screen.getByText(/1 tool call/)).toBeInTheDocument();
    expect(screen.queryByText(/1 tool calls/)).not.toBeInTheDocument();
  });

  it('styles intermediate agent-step text muted and indented', () => {
    renderMultiToolMessage([
      { type: 'text', text: "I'll delegate this to a sub-agent." },
      { type: 'tool-call', toolCallId: '1', toolName: 'first_tool', args: {}, result: 'a' },
      { type: 'text', text: 'Here is the final answer.' },
    ]);
    // Auto-collapses once final answer is confirmed — expand to inspect step text
    fireEvent.click(screen.getByText('Agent steps'));
    const intermediate = screen.getByText("I'll delegate this to a sub-agent.");
    const stepTextWrap = intermediate.closest("[class*='ml-[1.75rem]']");
    expect(stepTextWrap).toHaveClass('mb-2', 'text-text-secondary');
    const finalAnswer = screen.getByText('Here is the final answer.');
    expect(finalAnswer.closest("[class*='ml-[1.75rem]']")).toBeNull();
  });
});
