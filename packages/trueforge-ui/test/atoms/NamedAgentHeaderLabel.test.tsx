// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NamedAgentHeaderLabel } from '@/atoms/NamedAgentHeaderLabel.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import { RuntimeHarness } from '../containers/RuntimeHarness.js';

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
          isCreateAgent: true,
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

function SelectCloneDraft() {
  const shell = useShellMode();
  return (
    <button
      type="button"
      onClick={() =>
        shell.selectLibraryAgent({
          isMutable: true,
          isCreateAgent: true,
          agentName: 'reviewer-clone',
          agentSpec: { model: { name: 'openai/gpt-4.1' } },
        })
      }
    >
      clone
    </button>
  );
}

function OpenAgentBuilder() {
  const shell = useShellMode();
  return (
    <button type="button" onClick={() => shell.openAgentBuilder()}>
      new agent
    </button>
  );
}

describe('NamedAgentHeaderLabel', () => {
  it('shows the agent name for a named (immutable) chat', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'support' }}>
        <RuntimeHarness messages={[]}>
          <NamedAgentHeaderLabel />
        </RuntimeHarness>
      </ShellModeProvider>,
    );
    expect(screen.getByRole('heading', { name: 'support' })).toBeInTheDocument();
  });

  it('shows New Chat for unnamed draft chats', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
        <RuntimeHarness messages={[]}>
          <NamedAgentHeaderLabel />
        </RuntimeHarness>
      </ShellModeProvider>,
    );
    expect(screen.getByRole('heading', { name: 'New Chat' })).toBeInTheDocument();
  });

  it('shows New Agent after opening the agent builder', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
        <RuntimeHarness messages={[]}>
          <OpenAgentBuilder />
          <NamedAgentHeaderLabel />
        </RuntimeHarness>
      </ShellModeProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'new agent' }).click();
    });

    expect(screen.getByRole('heading', { name: 'New Agent' })).toBeInTheDocument();
  });

  it('shows an Editing label for a saved agent opened in mutable mode', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
        <RuntimeHarness messages={[]}>
          <SelectEditable />
          <NamedAgentHeaderLabel />
        </RuntimeHarness>
      </ShellModeProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'edit' }).click();
    });

    expect(screen.getByRole('heading', { name: 'reviewer Editing' })).toBeInTheDocument();
  });

  it('shows the clone draft name without an Editing label', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
        <RuntimeHarness messages={[]}>
          <SelectCloneDraft />
          <NamedAgentHeaderLabel />
        </RuntimeHarness>
      </ShellModeProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'clone' }).click();
    });

    expect(screen.getByRole('heading', { name: 'reviewer-clone' })).toBeInTheDocument();
    expect(screen.queryByText('Editing')).not.toBeInTheDocument();
  });

  it('is hidden while idle, then appears after selecting a named agent', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'AgentLibrary' }}>
        <RuntimeHarness messages={[]}>
          <SelectNamed />
          <NamedAgentHeaderLabel />
        </RuntimeHarness>
      </ShellModeProvider>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: 'select' }).click();
    });
    expect(screen.getByRole('heading', { name: 'reviewer' })).toBeInTheDocument();
  });
});
