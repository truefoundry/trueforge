// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { SaveAgentButton } from '@/atoms/SaveAgentButton.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import type { SaveAgentResult } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { RuntimeHarness } from '../containers/RuntimeHarness.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

type MockAgentSpec = {
  model?: { name?: string };
  skills?: { id: string; name: string }[];
  instructions?: string;
};

const agentSpecState: { agentSpec: MockAgentSpec } = {
  agentSpec: {
    model: { name: 'openai-main/gpt-4.1' },
    skills: [{ id: 's1', name: 'Skill One' }],
  },
};

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({
    agentSpec: agentSpecState.agentSpec,
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

const startedMessages = [{ role: 'user' as const, content: 'hello', id: 'm1' }];

type SaveAgentMock = ReturnType<typeof vi.fn<(...args: never[]) => Promise<SaveAgentResult>>>;

function mockServer(saveAgent: SaveAgentMock = vi.fn(async () => ({ agentId: 'agt_1' }))) {
  return createMockAgentUIServer({ saveAgent });
}

function getSubmitButton(dialog: HTMLElement): HTMLButtonElement {
  const button = dialog.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button === null) {
    throw new Error('Expected submit button');
  }
  return button;
}

function renderSaveAgent({
  children,
  messages = startedMessages,
  agentConfig,
  saveAgent,
}: {
  children: ReactNode;
  messages?: typeof startedMessages | [];
  agentConfig?: Parameters<typeof ShellModeProvider>[0]['agentConfig'];
  saveAgent?: SaveAgentMock;
}) {
  return render(
    <SlotsProvider>
      <ServerProvider server={mockServer(saveAgent)}>
        <ShellModeProvider agentConfig={agentConfig}>
          <RuntimeHarness messages={messages}>{children}</RuntimeHarness>
        </ShellModeProvider>
      </ServerProvider>
    </SlotsProvider>,
  );
}

describe('SaveAgentButton', () => {
  it('is hidden when the shell is locked to a named agent', () => {
    renderSaveAgent({
      agentConfig: { mode: 'SingleAgent', name: 'locked-agent' },
      children: <SaveAgentButton />,
    });

    expect(screen.queryByRole('button', { name: 'Save agent' })).not.toBeInTheDocument();
  });

  it('shows on an empty new chat when a model is selected', () => {
    renderSaveAgent({
      messages: [],
      children: <SaveAgentButton />,
    });

    expect(screen.getByRole('button', { name: 'Save agent' })).toBeInTheDocument();
  });

  it('is hidden when the draft has no model', () => {
    const previous = agentSpecState.agentSpec;
    agentSpecState.agentSpec = { skills: [{ id: 's1', name: 'Skill One' }] };
    try {
      renderSaveAgent({
        children: <SaveAgentButton />,
      });
      expect(screen.queryByRole('button', { name: 'Save agent' })).not.toBeInTheDocument();
    } finally {
      agentSpecState.agentSpec = previous;
    }
  });

  it('opens a modal with name + system instructions and saves them on agentSpec', async () => {
    const saveAgent = vi.fn(async () => ({ agentId: 'agt_1' }));

    renderSaveAgent({
      saveAgent,
      children: <SaveAgentButton />,
    });

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
    const saveAgent = vi.fn(async () => ({ agentId: 'agt_1' }));
    let shellSnap: ReturnType<typeof useShellMode> | undefined;

    function Probe() {
      shellSnap = useShellMode();
      return <SaveAgentButton />;
    }

    renderSaveAgent({
      saveAgent,
      children: <Probe />,
    });

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

    renderSaveAgent({
      saveAgent,
      children: <SaveAgentButton />,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }));
    const dialog = screen.getByRole('dialog', { name: 'Save agent' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'dup' } });
    fireEvent.click(getSubmitButton(dialog));

    await waitFor(() => {
      expect(screen.getByText('Name taken')).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog', { name: 'Save agent' })).toBeInTheDocument();
  });

  it('shows Update Agent on an empty library Edit and prefills name', async () => {
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

    renderSaveAgent({
      messages: [],
      agentConfig: { mode: 'AgentLibraryWithComposer' },
      children: <EditSeed />,
    });

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
