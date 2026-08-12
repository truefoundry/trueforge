// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentStepsCard } from '@/atoms/adapters/AgentStepsCardAdapter.js';

describe('AgentStepsCard', () => {
  it('formats tool and thought counts and invokes the controlled toggle', () => {
    const onToggle = vi.fn();
    render(
      <AgentStepsCard toolCount={1} thinkingCount={2} expanded={false} onToggle={onToggle} dataTestPrefix="agent">
        <div>step details</div>
      </AgentStepsCard>,
    );

    expect(screen.getByTestId('agent-agent-steps-card').className).toMatch(/bg-card-bg/);
    expect(screen.getByTestId('agent-agent-steps-card').className).toMatch(/text-text-primary/);
    expect(screen.getByText(/1 tool call/)).toBeInTheDocument();
    expect(screen.getByText(/2 thoughts/)).toBeInTheDocument();
    expect(screen.queryByText('step details')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Agent steps/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows expanded content, singular thought text, and active progress', () => {
    render(
      <AgentStepsCard
        toolCount={3}
        thinkingCount={1}
        expanded
        active
        onToggle={() => {}}
        background="rgb(1, 2, 3)"
        borderColor="rgb(4, 5, 6)"
        dataTestPrefix="agent"
      >
        <div>step details</div>
      </AgentStepsCard>,
    );

    expect(screen.getByText(/3 tool calls/)).toBeInTheDocument();
    expect(screen.getByText(/1 thought/)).toBeInTheDocument();
    expect(screen.getByTestId('agent-content')).toHaveTextContent('step details');
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.getByTestId('agent-agent-steps-card')).toHaveAttribute('data-expanded', 'true');
    expect(screen.getByTestId('agent-agent-steps-card')).toHaveStyle({
      background: 'rgb(1, 2, 3)',
      borderColor: 'rgb(4, 5, 6)',
    });
  });
});
