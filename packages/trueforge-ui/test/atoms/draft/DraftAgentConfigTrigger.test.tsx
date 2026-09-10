// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DraftAgentConfigTrigger } from '@/atoms/draft/DraftAgentConfigTrigger.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';

function Probe() {
  const shell = useShellMode();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          shell.openAgentBuilder();
          shell.setAgentConfigOpen(false);
        }}
      >
        Enter builder
      </button>
      <DraftAgentConfigTrigger />
      <span data-testid="open">{String(shell.agentConfigOpen)}</span>
    </>
  );
}

describe('DraftAgentConfigTrigger', () => {
  it('toggles the mutable agent config surface', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
        <Probe />
      </ShellModeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Enter builder' }));

    const trigger = screen.getByRole('button', { name: 'Agent config' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('open')).toHaveTextContent('true');
  });
});
