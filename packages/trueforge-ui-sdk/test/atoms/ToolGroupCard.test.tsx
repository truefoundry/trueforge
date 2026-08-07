// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToolGroupCard } from '@/atoms/ToolGroupCard.js';

describe('ToolGroupCard', () => {
  it('renders singular and plural tool-call labels', () => {
    const { rerender } = render(
      <ToolGroupCard toolCallCount={1} expanded={false} onToggle={() => {}}>
        content
      </ToolGroupCard>,
    );
    expect(screen.getByText('1 tool call')).toBeInTheDocument();

    rerender(
      <ToolGroupCard toolCallCount={3} expanded={false} onToggle={() => {}}>
        content
      </ToolGroupCard>,
    );
    expect(screen.getByText('3 tool calls')).toBeInTheDocument();
  });

  it('hides collapsed children and invokes the controlled toggle callback', () => {
    const onToggle = vi.fn();
    render(
      <ToolGroupCard toolCallCount={2} expanded={false} onToggle={onToggle}>
        <div>group content</div>
      </ToolGroupCard>,
    );

    expect(screen.queryByText('group content')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /2 tool calls/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows children and active progress when expanded', () => {
    render(
      <ToolGroupCard toolCallCount={2} expanded active onToggle={() => {}}>
        <div>group content</div>
      </ToolGroupCard>,
    );

    expect(screen.getByText('group content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2 tool calls/i })).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });
});
