// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('links to the schedule by id without selecting the row', async () => {
    const onSelect = vi.fn();
    const onOpenSchedule = vi.fn();
    render(
      <AgentSessionListRow
        {...baseProps}
        onSelect={onSelect}
        scheduleId="sched-1"
        onOpenSchedule={onOpenSchedule}
        loadScheduleName={async () => 'daily-digest'}
      />,
    );

    fireEvent.mouseEnter(screen.getByLabelText('Scheduled run'));
    fireEvent.click(await screen.findByRole('button', { name: 'View schedule daily-digest' }));

    expect(onOpenSchedule).toHaveBeenCalledWith({ id: 'sched-1', name: 'daily-digest' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('hides the schedule link when the name cannot be resolved', async () => {
    render(
      <AgentSessionListRow
        {...baseProps}
        scheduleId="sched-1"
        onOpenSchedule={vi.fn()}
        loadScheduleName={async () => null}
      />,
    );

    fireEvent.mouseEnter(screen.getByLabelText('Scheduled run'));
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Scheduled Run');
    expect(screen.queryByRole('button', { name: /View schedule/ })).not.toBeInTheDocument();
  });

  it('shows loading text while loading the schedule name on first hover, then the name', async () => {
    let resolveName: (name: string) => void = () => undefined;
    const loadScheduleName = vi.fn(
      () =>
        new Promise<string>(resolve => {
          resolveName = resolve;
        }),
    );
    render(
      <AgentSessionListRow
        {...baseProps}
        scheduleId="sched-1"
        onOpenSchedule={vi.fn()}
        loadScheduleName={loadScheduleName}
      />,
    );

    const icon = screen.getByLabelText('Scheduled run');
    fireEvent.mouseEnter(icon);
    expect(screen.getByRole('status')).toBeInTheDocument();

    resolveName('daily-digest');
    expect(await screen.findByRole('button', { name: 'View schedule daily-digest' })).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Scheduled Run');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Schedule name:daily-digest');

    fireEvent.mouseLeave(icon);
    fireEvent.mouseEnter(icon);
    expect(loadScheduleName).toHaveBeenCalledTimes(1);
    expect(loadScheduleName).toHaveBeenCalledWith('sched-1');
  });
});
