// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AgentStepsCardProps } from '@/atoms/adapters/AgentStepsCardAdapter.js';
import { AgentStepsContainer } from '@/containers/AgentStepsContainer.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

function AgentStepsCardProbe({ toolCount, thinkingCount, expanded, onToggle, children }: AgentStepsCardProps) {
  return (
    <section
      data-testid="agent-steps-probe"
      data-tool-count={toolCount}
      data-thinking-count={thinkingCount}
      data-expanded={String(expanded)}
    >
      <button type="button" onClick={onToggle}>
        Toggle steps
      </button>
      {expanded ? children : null}
    </section>
  );
}

function TestSubject({ hasFinal }: { hasFinal: boolean }) {
  return (
    <SlotsProvider overrides={{ AgentStepsCard: AgentStepsCardProbe }}>
      <AgentStepsContainer toolCount={2} thinkingCount={3} hasFinal={hasFinal}>
        <div>step details</div>
      </AgentStepsContainer>
    </SlotsProvider>
  );
}

describe('AgentStepsContainer', () => {
  it('maps counts and toggles its initially expanded children', () => {
    render(<TestSubject hasFinal={false} />);

    const probe = screen.getByTestId('agent-steps-probe');
    expect(probe).toHaveAttribute('data-tool-count', '2');
    expect(probe).toHaveAttribute('data-thinking-count', '3');
    expect(probe).toHaveAttribute('data-expanded', 'true');
    expect(screen.getByText('step details')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle steps' }));

    expect(probe).toHaveAttribute('data-expanded', 'false');
    expect(screen.queryByText('step details')).not.toBeInTheDocument();
  });

  it('auto-collapses once when a final answer appears and still allows manual expansion', async () => {
    const { rerender } = render(<TestSubject hasFinal={false} />);

    rerender(<TestSubject hasFinal />);

    await waitFor(() => {
      expect(screen.getByTestId('agent-steps-probe')).toHaveAttribute('data-expanded', 'false');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle steps' }));
    expect(screen.getByTestId('agent-steps-probe')).toHaveAttribute('data-expanded', 'true');

    rerender(<TestSubject hasFinal />);
    expect(screen.getByTestId('agent-steps-probe')).toHaveAttribute('data-expanded', 'true');
  });
});
