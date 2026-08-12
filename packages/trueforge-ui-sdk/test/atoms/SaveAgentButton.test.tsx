// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { SaveAgentButton } from '@/atoms/SaveAgentButton.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({
    agentSpec: {
      model: { name: 'openai-main/gpt-4.1' },
      skills: [{ id: 's1', name: 'Skill One' }],
    },
  }),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

function mockServer(saveAgent = vi.fn(async () => ({ ok: true }))) {
  return createMockAgentUIServer({ saveAgent });
}

function getSubmitButton(dialog: HTMLElement): HTMLButtonElement {
  const button = dialog.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button === null) {
    throw new Error('Expected submit button');
  }
  return button;
}

describe('SaveAgentButton', () => {
  it('is hidden when the shell is locked to a named agent', () => {
    render(
      <SlotsProvider>
        <ServerProvider server={mockServer()}>
          <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'locked-agent' }}>
            <SaveAgentButton />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Save agent' })).not.toBeInTheDocument();
  });

  it('opens a modal with name + system instructions and saves them on agentSpec', async () => {
    const saveAgent = vi.fn(async () => ({ ok: true }));

    render(
      <SlotsProvider>
        <ServerProvider server={mockServer(saveAgent)}>
          <ShellModeProvider>
            <SaveAgentButton />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    const dialog = screen.getByRole('dialog', { name: 'Save agent' });
    expect(dialog).toBeInTheDocument();
    expect(dialog.className).toContain('h-auto');
    expect(dialog.className).toContain('md:max-w-md');
    expect(dialog).toHaveStyle({ height: 'fit-content' });
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('System instructions')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  my-agent  ' } });
    fireEvent.change(screen.getByLabelText('System instructions'), {
      target: { value: '  You write release notes.  ' },
    });
    fireEvent.click(getSubmitButton(dialog));

    await waitFor(() => {
      expect(saveAgent).toHaveBeenCalledWith({
        agentName: 'my-agent',
        agentSpec: {
          model: { name: 'openai-main/gpt-4.1' },
          skills: [{ id: 's1', name: 'Skill One' }],
          instructions: 'You write release notes.',
        },
        intent: 'create',
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Save agent' })).not.toBeInTheDocument();
    });
    // Bound as mutable Edit with saved identity + spec; chrome flips to Update Agent.
    expect(screen.getByRole('button', { name: 'Update Agent' })).toBeInTheDocument();
  });

  it('binds the same draft chat as editable agent without remounting', async () => {
    const saveAgent = vi.fn(async () => ({ ok: true }));
    let shellSnap: ReturnType<typeof useShellMode> | undefined;

    function Probe() {
      shellSnap = useShellMode();
      return <SaveAgentButton />;
    }

    render(
      <SlotsProvider>
        <ServerProvider server={mockServer(saveAgent)}>
          <ShellModeProvider>
            <Probe />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    expect(shellSnap).toBeDefined();
    if (shellSnap == null) throw new Error('expected shell');
    const epochBefore = shellSnap.agentsListEpoch;
    const runtimeKeyBefore = shellSnap.runtimeKey;

    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    const dialog = screen.getByRole('dialog', { name: 'Save agent' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'saved-agent' } });
    fireEvent.change(screen.getByLabelText('System instructions'), {
      target: { value: 'Be helpful.' },
    });
    const submit = dialog.querySelector('button[type="submit"]');
    expect(submit).toBeInstanceOf(HTMLButtonElement);
    if (!(submit instanceof HTMLButtonElement)) throw new Error('expected submit');
    fireEvent.click(submit);

    await waitFor(() => {
      expect(shellSnap?.mode).toEqual({
        status: 'active',
        isMutable: true,
        agentId: 'saved-agent',
        agentName: 'saved-agent',
        agentSpec: {
          model: { name: 'openai-main/gpt-4.1' },
          skills: [{ id: 's1', name: 'Skill One' }],
          instructions: 'Be helpful.',
        },
        locked: false,
      });
    });
    expect(shellSnap.agentsListEpoch).toBe(epochBefore + 1);
    // Same chat continues — runtime must not remount.
    expect(shellSnap.runtimeKey).toBe(runtimeKeyBefore);
  });

  it('surfaces save errors without closing', async () => {
    const saveAgent = vi.fn(async () => {
      throw new Error('Name taken');
    });

    render(
      <SlotsProvider>
        <ServerProvider server={mockServer(saveAgent)}>
          <ShellModeProvider>
            <SaveAgentButton />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    const dialog = screen.getByRole('dialog', { name: 'Save agent' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'dup' } });
    fireEvent.click(getSubmitButton(dialog));

    await waitFor(() => {
      expect(screen.getByText('Name taken')).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog', { name: 'Save agent' })).toBeInTheDocument();
  });

  it('shows Update Agent and prefills name when editing a library agent', async () => {
    function EditSeed() {
      const shell = useShellMode();
      const seeded = useRef(false);
      useEffect(() => {
        if (seeded.current) return;
        seeded.current = true;
        shell.selectLibraryAgent({
          isMutable: true,
          agentId: 'writer',
          agentName: 'writer',
          agentSpec: {
            model: { name: 'openai-main/gpt-4.1' },
            instructions: 'Write release notes.',
          },
        });
      }, [shell]);
      return <SaveAgentButton />;
    }

    render(
      <SlotsProvider>
        <ServerProvider server={mockServer()}>
          <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>
            <EditSeed />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update Agent' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Update Agent' }));
    expect(screen.getByRole('dialog', { name: 'Update Agent' })).toBeInTheDocument();
    const nameInput = screen.getByLabelText('Name');
    expect(nameInput).toHaveValue('writer');
    expect(nameInput).toBeDisabled();
    expect(screen.getByLabelText('System instructions')).toHaveValue('Write release notes.');
  });
});
