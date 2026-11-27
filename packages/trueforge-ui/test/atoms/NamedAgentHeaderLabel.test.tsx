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

function LibraryOpenProbe() {
  const shell = useShellMode();
  return <output aria-label="Library open">{shell.libraryOpen ? 'yes' : 'no'}</output>;
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
    const heading = screen.getByRole('heading', { name: 'support' });
    expect(heading).toBeInTheDocument();
    expect(heading.querySelector('svg')).not.toBeNull();
  });

  it('shows an agent icon before the name in Try Agent mode', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>
        <RuntimeHarness messages={[]}>
          <SelectNamed />
          <NamedAgentHeaderLabel />
        </RuntimeHarness>
      </ShellModeProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'select' }).click();
    });

    const heading = screen.getByRole('heading', { name: /reviewer/ });
    expect(heading.querySelector('svg')).not.toBeNull();
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

  it('shows only the agent name for a saved agent opened in mutable mode', () => {
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

    expect(screen.getByRole('heading', { name: 'reviewer' })).toBeInTheDocument();
    expect(screen.queryByText('Editing')).not.toBeInTheDocument();
  });

  it('shows the clone draft name', () => {
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
    expect(screen.getByRole('heading', { name: /reviewer/ })).toBeInTheDocument();
  });

  it('returns to the agents page from a Try session', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'AgentLibrary' }}>
        <RuntimeHarness messages={[]}>
          <SelectNamed />
          <LibraryOpenProbe />
          <NamedAgentHeaderLabel />
        </RuntimeHarness>
      </ShellModeProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'select' }).click();
    });
    expect(screen.getByRole('button', { name: 'Back to all agents' })).toBeInTheDocument();
    expect(screen.getByLabelText('Library open')).toHaveTextContent('no');

    act(() => {
      screen.getByRole('button', { name: 'Back to all agents' }).click();
    });
    expect(screen.getByLabelText('Library open')).toHaveTextContent('yes');
  });
});
