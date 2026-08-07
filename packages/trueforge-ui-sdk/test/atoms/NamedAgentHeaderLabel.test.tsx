// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NamedAgentHeaderLabel } from '@/atoms/NamedAgentHeaderLabel.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';

function SelectNamed() {
  const shell = useShellMode();
  return (
    <button type="button" onClick={() => shell.selectAgent('reviewer')}>
      select
    </button>
  );
}

describe('NamedAgentHeaderLabel', () => {
  it('shows the agent name for a named (immutable) chat', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'support' }}>
        <NamedAgentHeaderLabel />
      </ShellModeProvider>,
    );
    expect(screen.getByRole('heading', { name: 'support' })).toBeInTheDocument();
  });

  it('is hidden for draft / mutable chats', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
        <NamedAgentHeaderLabel />
      </ShellModeProvider>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('is hidden while idle, then appears after selecting a named agent', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'AgentLibrary' }}>
        <SelectNamed />
        <NamedAgentHeaderLabel />
      </ShellModeProvider>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: 'select' }).click();
    });
    expect(screen.getByRole('heading', { name: 'reviewer' })).toBeInTheDocument();
  });
});
