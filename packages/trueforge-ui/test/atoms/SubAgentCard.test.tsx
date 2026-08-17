// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Markdown } from '@/atoms/Markdown.js';
import { SubAgentCard } from '@/atoms/SubAgentCard.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

function MarkdownStub({ content }: ComponentProps<typeof Markdown>) {
  return <div data-testid="instruction-markdown">{content}</div>;
}

function renderCard(props: ComponentProps<typeof SubAgentCard>) {
  return render(
    <SlotsProvider overrides={{ Markdown: MarkdownStub }}>
      <SubAgentCard {...props} />
    </SlotsProvider>,
  );
}

describe('SubAgentCard', () => {
  it('hides collapsed details and invokes the expansion callback', () => {
    const onToggle = vi.fn();
    renderCard({
      agentName: 'Researcher',
      instruction: 'Find primary sources',
      stepCount: 2,
      status: 'running',
      expanded: false,
      onToggle,
      durationText: '12s',
      children: <div>nested steps</div>,
      dataTestPrefix: 'sub',
    });

    expect(screen.getByText('Sub-agent: Researcher')).toBeInTheDocument();
    expect(screen.getByText('12s')).toBeInTheDocument();
    expect(screen.queryByText('Find primary sources')).not.toBeInTheDocument();
    expect(screen.queryByText('nested steps')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand step' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('renders instructions and nested content when expanded', () => {
    renderCard({
      agentName: 'Coder',
      instruction: 'Implement the fix',
      stepCount: 3,
      status: 'success',
      expanded: true,
      onToggle: () => {},
      children: <div>child tool call</div>,
      dataTestPrefix: 'sub',
    });

    expect(screen.getByTestId('instruction-markdown')).toHaveTextContent('Implement the fix');
    expect(screen.getByTestId('sub-instructions')).toBeInTheDocument();
    expect(screen.getByTestId('sub-nested-content')).toHaveTextContent('child tool call');
    expect(screen.getByTestId('sub-success-icon')).toBeInTheDocument();
  });

  it('uses a custom instruction renderer and maps error status', () => {
    const renderInstruction = vi.fn((instruction: string) => <strong>Custom: {instruction}</strong>);
    const { container } = renderCard({
      agentName: 'Reviewer',
      instruction: 'Review changes',
      stepCount: 1,
      status: 'error',
      expanded: true,
      onToggle: () => {},
      renderInstruction,
      dataTestPrefix: 'sub',
    });

    expect(renderInstruction).toHaveBeenCalledWith('Review changes');
    expect(screen.getByText('Custom: Review changes')).toBeInTheDocument();
    expect(container.querySelector('svg.text-failure-bg')).toBeInTheDocument();
  });

  it('omits the instruction section for whitespace-only instructions', () => {
    renderCard({
      agentName: 'Idle',
      instruction: '   ',
      stepCount: 0,
      status: 'success',
      expanded: true,
      onToggle: () => {},
      dataTestPrefix: 'sub',
    });

    expect(screen.queryByText('Instructions')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sub-instructions')).not.toBeInTheDocument();
  });
});
