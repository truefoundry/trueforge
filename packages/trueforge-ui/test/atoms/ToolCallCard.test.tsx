// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToolCallCard } from '@/atoms/ToolCallCard.js';

describe('ToolCallCard', () => {
  it('toggles expandable request content and only shows response content when expanded', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ToolCallCard
        toolName="Search docs"
        expanded={false}
        onToggle={onToggle}
        requestSlot={<div>request body</div>}
        responseSlot={<div>response body</div>}
        showResponseLine
        dataTestPrefix="search"
      />,
    );

    expect(screen.queryByText('request body')).not.toBeInTheDocument();
    expect(screen.queryByText('response body')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand step' }));
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(
      <ToolCallCard
        toolName="Search docs"
        expanded
        onToggle={onToggle}
        requestSlot={<div>request body</div>}
        responseSlot={<div>response body</div>}
        showResponseLine
        dataTestPrefix="search"
      />,
    );
    expect(screen.getByText('request body')).toBeInTheDocument();
    expect(screen.getByText('response body')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse step' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('derives running, success, and error presentation from awaiting and exit code', () => {
    const { container, rerender } = render(
      <ToolCallCard toolName="Run" awaiting awaitingText="Executing…" dataTestPrefix="run" />,
    );
    expect(screen.getByText('Executing…')).toBeInTheDocument();
    expect(screen.queryByTestId('run-header-success-icon')).not.toBeInTheDocument();

    rerender(<ToolCallCard toolName="Run" exitCode={0} dataTestPrefix="run" />);
    expect(screen.getByTestId('run-header-success-icon')).toBeInTheDocument();

    rerender(<ToolCallCard toolName="Run" exitCode={2} dataTestPrefix="run" />);
    expect(container.querySelector('svg.text-failure-bg')).toBeInTheDocument();
  });

  it('honors explicit status and suppresses expansion when no expandable content exists', () => {
    const { container } = render(
      <ToolCallCard toolName="Failed tool" status="error" onToggle={vi.fn()} dataTestPrefix="failed" />,
    );

    expect(container.querySelector('svg.text-failure-bg')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand step' })).not.toBeInTheDocument();
  });

  it('keeps approval content visible while request content is collapsed', () => {
    render(
      <ToolCallCard
        toolName="Protected tool"
        approvalSlot={<div>approval controls</div>}
        requestSlot={<div>private request</div>}
      />,
    );

    expect(screen.getByText('approval controls')).toBeInTheDocument();
    expect(screen.queryByText('private request')).not.toBeInTheDocument();
  });
});
