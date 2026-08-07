// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Markdown } from '@/atoms/Markdown.js';
import { ReasoningCard } from '@/atoms/adapters/ReasoningCardAdapter.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

function MarkdownProbe({ content }: ComponentProps<typeof Markdown>) {
  return <div data-testid="markdown-probe">{content}</div>;
}

function renderSubject(props: ComponentProps<typeof ReasoningCard>) {
  return render(
    <SlotsProvider overrides={{ Markdown: MarkdownProbe }}>
      <ReasoningCard {...props} />
    </SlotsProvider>,
  );
}

describe('ReasoningCard', () => {
  it('summarizes completed one-line reasoning and exposes its controlled toggle', () => {
    const onToggle = vi.fn();
    renderSubject({
      content: 'Checked the deployment state.',
      reasoningTimeText: 'Reasoned for 2s',
      onToggle,
      dataTestPrefix: 'reason',
    });

    expect(screen.getByTestId('reason-reasoning-inline')).toBeInTheDocument();
    expect(screen.getByTestId('reason-title')).toHaveTextContent('Reasoned for 2s');
    expect(screen.queryByTestId('reason-content')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand step' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('renders expanded multiline content through the Markdown slot and provides its content node', () => {
    const contentRef = vi.fn();
    renderSubject({
      content: 'First line\nSecond line',
      expanded: true,
      isMultiLine: true,
      contentRef,
      onToggle: () => {},
      dataTestPrefix: 'reason',
    });

    const content = screen.getByTestId('reason-content');
    expect(screen.getByTestId('reason-reasoning-accordion')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-probe')).toHaveTextContent(/First line\s+Second line/);
    expect(contentRef).toHaveBeenCalledWith(content);
    expect(screen.getByRole('button', { name: 'Collapse step' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps empty completed reasoning idle and non-expandable', () => {
    const onToggle = vi.fn();
    renderSubject({
      content: '',
      onToggle,
      dataTestPrefix: 'reason',
    });

    expect(screen.getByTestId('reason-title')).toHaveTextContent('Reasoning');
    expect(screen.queryByRole('button', { name: /step/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('markdown-probe')).not.toBeInTheDocument();
  });

  it('uses the streaming heading and remains expandable before content arrives', () => {
    const onToggle = vi.fn();
    renderSubject({
      content: '',
      isStreaming: true,
      headingText: 'Thinking through changes',
      onToggle,
      dataTestPrefix: 'reason',
    });

    expect(screen.getByTestId('reason-title')).toHaveTextContent('Thinking through changes');
    expect(screen.getByRole('button', { name: 'Expand step' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand step' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
