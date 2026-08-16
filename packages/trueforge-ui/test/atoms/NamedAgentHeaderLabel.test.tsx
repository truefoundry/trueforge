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

function SelectEditable() {
  const shell = useShellMode();
  return (
    <button
      type="button"
      onClick={() =>
        shell.selectLibraryAgent({
          isMutable: true,
          agentId: 'reviewer',
          agentName: 'reviewer',
          agentSpec: { model: { name: 'openai/gpt-4.1' } },
        })
      }
    >
      edit
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

  it('is hidden for unnamed draft chats', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
        <NamedAgentHeaderLabel />
      </ShellModeProvider>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('shows an Editing label for a saved agent opened in mutable mode', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
        <SelectEditable />
        <NamedAgentHeaderLabel />
      </ShellModeProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'edit' }).click();
    });

    expect(screen.getByRole('heading', { name: 'reviewer Editing' })).toBeInTheDocument();
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
