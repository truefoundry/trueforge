// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentSessionListRow } from '@/atoms/agent-details/AgentSessionListRow.js';
import type { AgentSessionListRowProps } from '@/atoms/agent-details/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

describe('AgentSessionListRow', () => {
  const baseProps: AgentSessionListRowProps = {
    title: 'Test Session',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    metrics: {
      totalTurns: 3,
      totalCostInUsd: 0.12,
      totalDurationMs: 45_000,
    },
    active: false,
    onSelect: vi.fn(),
  };

  it('renders title and formatted metrics', () => {
    render(
      <SlotsProvider>
        <AgentSessionListRow {...baseProps} />
      </SlotsProvider>,
    );

    expect(screen.getByText('Test Session')).toBeInTheDocument();
    expect(screen.getByText('3 turns | $0.1200 | 45s')).toBeInTheDocument();
  });

  it('renders both agent name and creator subject with user icon and details', async () => {
    render(
      <SlotsProvider>
        <AgentSessionListRow
          {...baseProps}
          agentName="ask-ai-devtest"
          createdBySubject={{
            subjectId: 'user-123',
            subjectType: 'user',
            subjectDisplayName: 'Chirag Jain',
          }}
        />
      </SlotsProvider>,
    );

    expect(screen.getByText('ask-ai-devtest')).toBeInTheDocument();
    expect(screen.getByText('Chirag Jain')).toBeInTheDocument();

    // Hover to reveal detailed tooltip
    fireEvent.mouseEnter(screen.getByText('Chirag Jain'));
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText(/Subject Name:/)).toBeInTheDocument();
    expect(screen.getByText(/Subject Type:/)).toBeInTheDocument();
  });

  it('renders creator subject name when agent name is omitted', () => {
    render(
      <SlotsProvider>
        <AgentSessionListRow
          {...baseProps}
          createdBySubject={{
            subjectId: 'user-123',
            subjectType: 'user',
            subjectDisplayName: 'Chirag Jain',
          }}
        />
      </SlotsProvider>,
    );

    expect(screen.queryByText('ask-ai-devtest')).not.toBeInTheDocument();
    expect(screen.getByText('Chirag Jain')).toBeInTheDocument();
  });

  it('falls back to subjectId when subjectDisplayName is empty', () => {
    render(
      <SlotsProvider>
        <AgentSessionListRow
          {...baseProps}
          agentName="ask-ai-devtest"
          createdBySubject={{
            subjectId: 'cm1fa35mt009e8trdl1v5831p',
            subjectType: 'user',
            subjectDisplayName: '',
          }}
        />
      </SlotsProvider>,
    );

    expect(screen.getByText('cm1fa35mt009e8trdl1v5831p')).toBeInTheDocument();
  });

  it('renders only relative time when both agent name and createdBySubject are omitted', () => {
    render(
      <SlotsProvider>
        <AgentSessionListRow {...baseProps} />
      </SlotsProvider>,
    );

    expect(screen.queryByText('·')).not.toBeInTheDocument();
  });

  it('calls onSelect when row is clicked', () => {
    const onSelect = vi.fn();
    render(
      <SlotsProvider>
        <AgentSessionListRow {...baseProps} onSelect={onSelect} />
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByText('Test Session'));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
