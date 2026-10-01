// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentSessionListRow } from '@/atoms/agent-details/AgentSessionListRow.js';

const baseProps = {
  title: 'Hello session',
  lastActivityAt: '2026-01-02T00:00:00.000Z',
  metrics: { totalTurns: 1, totalDurationMs: 1000 },
  active: false,
  onSelect: () => undefined,
};

describe('AgentSessionListRow', () => {
  it('shows a subject avatar with name tooltip in the meta row', () => {
    const { container } = render(
      <AgentSessionListRow
        {...baseProps}
        agentName="writer"
        createdBySubject={{
          subjectId: 'user-1',
          subjectType: 'user',
          subjectDisplayName: 'alice@example.com',
        }}
      />,
    );

    const avatar = screen.getByLabelText('alice@example.com');
    expect(avatar).toBeInTheDocument();
    expect(container.querySelector('[data-slot="avatar-fallback"]')).toHaveTextContent('A');
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();

    fireEvent.mouseEnter(avatar);
    expect(screen.getByRole('tooltip')).toHaveTextContent('alice@example.com');
  });

  it('hides the subject avatar when createdBySubject is omitted', () => {
    const { container } = render(<AgentSessionListRow {...baseProps} agentName="writer" />);

    expect(container.querySelector('[data-slot="avatar"]')).not.toBeInTheDocument();
  });

  it('invokes onSelect when the meta row is clicked', () => {
    const onSelect = vi.fn();
    render(<AgentSessionListRow {...baseProps} onSelect={onSelect} agentName="writer" />);

    fireEvent.click(screen.getByText('writer'));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
