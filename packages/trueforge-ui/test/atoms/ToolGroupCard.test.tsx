// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToolGroupCard } from '@/atoms/ToolGroupCard.js';

describe('ToolGroupCard', () => {
  it('renders the parallel tool-call label', () => {
    render(
      <ToolGroupCard toolCallCount={3} expanded={false} onToggle={() => {}}>
        content
      </ToolGroupCard>,
    );
    expect(screen.getByText('3 tool calls in parallel')).toBeInTheDocument();
  });

  it('hides collapsed children and invokes the controlled toggle callback', () => {
    const onToggle = vi.fn();
    render(
      <ToolGroupCard toolCallCount={2} expanded={false} onToggle={onToggle}>
        <div>group content</div>
      </ToolGroupCard>,
    );

    expect(screen.queryByText('group content')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Expand step/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows children and running status when expanded', () => {
    render(
      <ToolGroupCard toolCallCount={2} expanded status="running" onToggle={() => {}}>
        <div>group content</div>
      </ToolGroupCard>,
    );

    expect(screen.getByText('group content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Collapse step/i })).toHaveAttribute('aria-expanded', 'true');
  });
});
