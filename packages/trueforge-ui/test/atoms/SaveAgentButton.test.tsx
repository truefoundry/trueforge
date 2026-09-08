// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { cloneElement, isValidElement, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SaveAgentButton } from '@/atoms/SaveAgentButton.js';
import {
  AgentConfigInstructionsProvider,
  useAgentConfigInstructions,
} from '@/atoms/draft/AgentConfigInstructionsContext.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode, type AgentConfig } from '@/server/ShellModeContext.js';
import type { AgentSpec, AgentUIServer, SaveAgentRequest, SaveAgentResult } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

let agentSpec: AgentSpec;
const flushAgentSpec = vi.fn(async () => undefined);
const adoptAgentSpec = vi.fn();
const updateAgentSpec = vi.fn();

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({ agentSpec, draftSessionId: 'draft-1' }),
  useTrueFoundryFlushAgentSpec: () => flushAgentSpec,
  useTrueFoundryAdoptAgentSpec: () => adoptAgentSpec,
  useTrueFoundryUpdateAgentSpec: () => updateAgentSpec,
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

function OpenAgentBuilderOnMount({ children }: { children: ReactNode }) {
  const { openAgentBuilder, mode } = useShellMode();
  useLayoutEffect(() => {
    if (mode.status === 'active' && mode.isMutable && !mode.isCreateAgent) {
      openAgentBuilder();
    }
  }, [mode, openAgentBuilder]);
  return children;
}

function renderButton({
  saveAgent = vi.fn(async (): Promise<SaveAgentResult> => ({ agentId: 'agent-1' })),
  agentConfig = { mode: 'AgentComposer' as const },
  serverOverrides = {},
  children = <SaveAgentButton />,
}: {
  saveAgent?: (request: SaveAgentRequest) => Promise<SaveAgentResult>;
  agentConfig?: AgentConfig;
  serverOverrides?: Partial<AgentUIServer>;
  children?: ReactNode;
} = {}) {
  const server = createMockAgentUIServer({
    getModels: async () => [
      {
        id: 'openai/gpt-4.1',
        name: 'openai/gpt-4.1',
        provider: { name: 'OpenAI' },
        properties: {},
      },
      {
        id: 'anthropic/claude-sonnet-4-6',
        name: 'anthropic/claude-sonnet-4-6',
        provider: { name: 'Anthropic' },
        properties: {},
      },
    ],
    getMcp: async () => [
      { id: 'github', name: 'GitHub', authenticated: true },
      { id: 'slack', name: 'Slack', authenticated: true },
    ],
    getSkills: async () => [
      { id: 'research', name: 'Research' },
      { id: 'writing', name: 'Writing' },
    ],
    ...serverOverrides,
    saveAgent,
  });
  const tree = () => (
    <SlotsProvider>
      <ServerProvider server={server}>
        <ShellModeProvider agentConfig={agentConfig}>
          <OpenAgentBuilderOnMount>
            {isValidElement(children) ? cloneElement(children) : children}
          </OpenAgentBuilderOnMount>
        </ShellModeProvider>
      </ServerProvider>
    </SlotsProvider>
  );
  const rendered = render(tree());
  return {
    saveAgent,
    ...rendered,
    rerenderButton: () => rendered.rerender(tree()),
  };
}

function BoundMutableSaveButton({ agentId, agentName }: { agentId: string; agentName?: string }) {
  const { selectLibraryAgent } = useShellMode();
  useEffect(() => {
    selectLibraryAgent({
      isMutable: true,
      isCreateAgent: true,
      agentId,
      agentName,
      agentSpec,
    });
  }, [agentId, agentName, selectLibraryAgent]);
  return <SaveAgentButton />;
}

function SaveWithInstructionDraft() {
  const { onChange } = useAgentConfigInstructions();
  return (
    <>
      <button type="button" onClick={() => onChange('Instructions currently visible in the drawer.')}>
        Edit instructions
      </button>
      <SaveAgentButton />
    </>
  );
}

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>(resolve => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (resolvePromise === undefined) throw new Error('Deferred promise was not initialized');
      resolvePromise(value);
    },
  };
}

describe('SaveAgentButton', () => {
  beforeEach(() => {
    agentSpec = {
      model: { name: 'openai/gpt-4.1' },
      instructions: 'Be helpful.',
      mcpServers: [{ id: 'github', name: 'GitHub' }],
      skills: [{ id: 'research', name: 'Research' }],
    };
    flushAgentSpec.mockReset();
    flushAgentSpec.mockResolvedValue(undefined);
    adoptAgentSpec.mockClear();
    updateAgentSpec.mockClear();
  });

  it('is hidden when the shell is locked to a named agent', () => {
    renderButton({ agentConfig: { mode: 'SingleAgent', name: 'locked-agent' } });
    expect(screen.queryByRole('button', { name: 'Save Agent' })).not.toBeInTheDocument();
  });

  it('shows on an empty new chat when a model is selected', () => {
    renderButton();
    expect(screen.getByRole('button', { name: 'Save Agent' })).toHaveClass(
      'bg-primary-button-bg',
      'text-primary-button-text',
    );
  });

  it('is hidden when the draft has no model', () => {
    agentSpec = {
      model: { name: '' },
      skills: [{ id: 's1', name: 'Skill One' }],
    };
    renderButton();
    expect(screen.queryByRole('button', { name: 'Save Agent' })).not.toBeInTheDocument();
  });

  it('is hidden in idle library mode without loading catalogs', () => {
    const getModels = vi.fn(async () => []);
    const getSkills = vi.fn(async () => []);
    const getMcp = vi.fn(async () => []);
    renderButton({
      agentConfig: { mode: 'AgentLibrary' },
      serverOverrides: { getModels, getSkills, getMcp },
    });

    expect(screen.queryByRole('button', { name: 'Save Agent' })).not.toBeInTheDocument();
    expect(getModels).not.toHaveBeenCalled();
    expect(getSkills).not.toHaveBeenCalled();
    expect(getMcp).not.toHaveBeenCalled();
  });

  it('uses SDK theme tokens for editable controls', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));

    const dialog = await screen.findByRole('dialog', { name: 'Save agent' });
    expect(dialog).toHaveClass('bg-card-bg', 'text-text-primary', 'md:ml-auto', 'md:mr-0', 'md:h-dvh');
    expect(within(dialog).getByLabelText('Agent name')).toHaveClass(
      'border-input-border',
      'bg-input-box-bg',
      'text-text-primary',
      'focus-visible:ring-focus-ring/40',
    );
    expect(within(dialog).getByLabelText('Description')).toHaveClass(
      'border-input-border',
      'bg-input-box-bg',
      'text-text-primary',
      'focus-visible:ring-focus-ring/40',
    );
    expect(within(dialog).queryByRole('button', { name: 'Edit Model' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Edit Runtime Config' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Edit Connectors' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Edit Skills' })).not.toBeInTheDocument();
  });

  it('submits description while preserving configuration from the agent drawer', async () => {
    const saveAgent = vi.fn(async (): Promise<SaveAgentResult> => ({ agentId: 'agent-1' }));
    renderButton({ saveAgent });
    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));

    const dialog = await screen.findByRole('dialog', { name: 'Save agent' });
    fireEvent.change(within(dialog).getByLabelText('Agent name'), { target: { value: 'writer' } });
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Writes release notes.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(saveAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentSpec: expect.objectContaining({
            description: 'Writes release notes.',
            instructions: 'Be helpful.',
            mcpServers: [{ id: 'github', name: 'GitHub' }],
            skills: [{ id: 'research', name: 'Research' }],
          }),
        }),
      ),
    );
  });

  it('opens with the latest runtime spec after flushing pending picker edits', async () => {
    const pendingFlush = deferred<undefined>();
    flushAgentSpec.mockReturnValueOnce(pendingFlush.promise);
    const saveAgent = vi.fn(async (): Promise<SaveAgentResult> => ({ agentId: 'agent-1' }));
    const rendered = renderButton({ saveAgent });

    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    await waitFor(() => expect(flushAgentSpec).toHaveBeenCalledOnce());

    agentSpec = {
      model: { name: 'openai/gpt-4.1' },
      instructions: 'Latest flushed instructions.',
      mcpServers: [{ id: 'slack', name: 'Slack' }],
      skills: [{ id: 'writing', name: 'Writing' }],
      config: { generativeUi: { enabled: false } },
    };
    rendered.rerenderButton();
    pendingFlush.resolve(undefined);

    const dialog = await screen.findByRole('dialog', { name: 'Save agent' });
    fireEvent.change(within(dialog).getByLabelText('Agent name'), { target: { value: 'latest-agent' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(saveAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentSpec: expect.objectContaining({
            instructions: 'Latest flushed instructions.',
            mcpServers: [{ id: 'slack', name: 'Slack' }],
            skills: [{ id: 'writing', name: 'Writing' }],
            config: { generativeUi: { enabled: false } },
          }),
        }),
      ),
    );
  });

  it('uses the drawer instruction draft when opening before debounce sync completes', async () => {
    const saveAgent = vi.fn(async (): Promise<SaveAgentResult> => ({ agentId: 'agent-1' }));
    renderButton({
      saveAgent,
      children: <SaveAgentButton instructionsOverride="Instructions currently visible in the drawer." />,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save agent' });
    fireEvent.change(within(dialog).getByLabelText('Agent name'), { target: { value: 'writer' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(saveAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentSpec: expect.objectContaining({ instructions: 'Instructions currently visible in the drawer.' }),
        }),
      ),
    );
  });

  it('flushes the shared instruction draft when opening Save Agent', async () => {
    const saveAgent = vi.fn(async (): Promise<SaveAgentResult> => ({ agentId: 'agent-1' }));
    renderButton({
      saveAgent,
      children: (
        <AgentConfigInstructionsProvider>
          <SaveWithInstructionDraft />
        </AgentConfigInstructionsProvider>
      ),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit instructions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save agent' });
    fireEvent.change(within(dialog).getByLabelText('Agent name'), { target: { value: 'writer' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(updateAgentSpec).toHaveBeenCalledWith({
      instructions: 'Instructions currently visible in the drawer.',
    });
    await waitFor(() =>
      expect(saveAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentSpec: expect.objectContaining({ instructions: 'Instructions currently visible in the drawer.' }),
        }),
      ),
    );
  });

  it('labels an existing mutable binding as Update Agent and submits an update', async () => {
    const saveAgent = vi.fn(async (): Promise<SaveAgentResult> => ({ agentId: 'writer' }));
    renderButton({
      saveAgent,
      children: <BoundMutableSaveButton agentId="writer" />,
    });

    const trigger = await screen.findByRole('button', { name: 'Update Agent' });
    expect(screen.queryByRole('button', { name: 'Save Agent' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Update agent' });
    expect(within(dialog).getByLabelText('Agent name')).toHaveValue('writer');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(saveAgent).toHaveBeenCalledWith(expect.objectContaining({ agentName: 'writer', intent: 'update' })),
    );
  });

  it('discards drawer-only changes when closed', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save agent' });
    fireEvent.change(within(dialog).getByLabelText('Agent name'), { target: { value: 'discard-me' } });
    fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Discarded description' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    const reopened = await screen.findByRole('dialog', { name: 'Save agent' });
    expect(within(reopened).getByLabelText('Agent name')).toHaveValue('');
    expect(within(reopened).getByLabelText('Description')).toHaveValue('');
  });

  it('submits one explicit create request and adopts the persisted session spec', async () => {
    const saveAgent = vi.fn(async (): Promise<SaveAgentResult> => ({
      agentId: 'agent-1',
      sessionUpdatedAt: '2026-08-12T08:00:00.000Z',
    }));
    renderButton({ saveAgent });
    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save agent' });
    fireEvent.change(within(dialog).getByLabelText('Agent name'), { target: { value: 'my-agent' } });
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Writes release notes.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(saveAgent).toHaveBeenCalledOnce());
    expect(saveAgent).toHaveBeenCalledWith({
      agentName: 'my-agent',
      agentSpec: {
        model: { name: 'openai/gpt-4.1', params: undefined },
        instructions: 'Be helpful.',
        mcpServers: [{ id: 'github', name: 'GitHub' }],
        skills: [{ id: 'research', name: 'Research' }],
        config: undefined,
        description: 'Writes release notes.',
      },
      intent: 'create',
      sessionId: 'draft-1',
    });
    await waitFor(() =>
      expect(adoptAgentSpec).toHaveBeenCalledWith({
        agentSpec: expect.objectContaining({ model: { name: 'openai/gpt-4.1', params: undefined } }),
        updatedAt: '2026-08-12T08:00:00.000Z',
      }),
    );
  });

  it('preserves opaque mount fields without exposing resource editors', async () => {
    agentSpec = {
      model: { name: 'openai/gpt-4.1' },
      mcpServers: [{ id: 'github', name: 'GitHub', enableTools: ['@read-only'], config: { project: 'sdk' } }],
      skills: [{ id: 'research', name: 'Research', fqn: 'skills/research:1', config: { depth: 2 } }],
    };
    const saveAgent = vi.fn(async (): Promise<SaveAgentResult> => ({ agentId: 'agent-1' }));
    renderButton({ saveAgent });
    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    const saveDialog = await screen.findByRole('dialog', { name: 'Save agent' });
    fireEvent.change(within(saveDialog).getByLabelText('Agent name'), { target: { value: 'preserved-agent' } });
    fireEvent.click(within(saveDialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(saveAgent).toHaveBeenCalledOnce());
    expect(saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSpec: expect.objectContaining({
          mcpServers: [{ id: 'github', name: 'GitHub', enableTools: ['@read-only'], config: { project: 'sdk' } }],
          skills: [{ id: 'research', name: 'Research', fqn: 'skills/research:1', config: { depth: 2 } }],
        }),
      }),
    );
  });

  it('keeps the save form immutable until an in-flight request settles', async () => {
    const pending = deferred<SaveAgentResult>();
    renderButton({ saveAgent: vi.fn(() => pending.promise) });
    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save agent' });
    fireEvent.change(within(dialog).getByLabelText('Agent name'), { target: { value: 'pending-agent' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(within(dialog).getByLabelText('Agent name')).toBeDisabled();
    expect(within(dialog).getByLabelText('Description')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();

    pending.resolve({ agentId: 'agent-1' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save agent' })).not.toBeInTheDocument());
  });

  it('surfaces API-shaped save errors', async () => {
    renderButton({
      saveAgent: vi.fn(async () => {
        throw { body: { error: { message: 'Agent name already exists' } } };
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save agent' });
    fireEvent.change(within(dialog).getByLabelText('Agent name'), { target: { value: 'duplicate' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Agent name already exists');
  });

  it('preserves decoded escapes in validation error messages', async () => {
    renderButton({
      saveAgent: vi.fn(async () => {
        throw {
          body: {
            error: {
              message: 'line one\\nline two\\tindented',
            },
          },
        };
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save agent' });
    fireEvent.change(within(dialog).getByLabelText('Agent name'), { target: { value: 'bad name' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveClass('whitespace-pre-wrap');
    expect(alert.textContent).toBe('line one\nline two\tindented');
  });
});
