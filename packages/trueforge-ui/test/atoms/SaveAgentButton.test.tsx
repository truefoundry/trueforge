// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { cloneElement, isValidElement, useEffect, type ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SaveAgentButton } from '@/atoms/SaveAgentButton.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode, type AgentConfig } from '@/server/ShellModeContext.js';
import type { AgentSpec, AgentUIServer, SaveAgentRequest, SaveAgentResult } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

let agentSpec: AgentSpec;
const flushAgentSpec = vi.fn(async () => undefined);
const adoptAgentSpec = vi.fn();

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({ agentSpec, draftSessionId: 'draft-1' }),
  useTrueFoundryFlushAgentSpec: () => flushAgentSpec,
  useTrueFoundryAdoptAgentSpec: () => adoptAgentSpec,
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
          {isValidElement(children) ? cloneElement(children) : children}
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
      agentId,
      agentName,
      agentSpec,
    });
  }, [agentId, agentName, selectLibraryAgent]);
  return <SaveAgentButton />;
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

async function findStackedDialog(label: string): Promise<HTMLDialogElement> {
  await waitFor(() => expect(document.querySelectorAll('dialog')[1]).toHaveAttribute('aria-label', label));
  const dialog = document.querySelectorAll('dialog')[1];
  if (!(dialog instanceof HTMLDialogElement)) throw new Error(`Expected stacked dialog: ${label}`);
  return dialog;
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
  });

  it('is hidden when the shell is locked to a named agent', () => {
    renderButton({ agentConfig: { mode: 'SingleAgent', name: 'locked-agent' } });
    expect(screen.queryByRole('button', { name: 'Save Agent' })).not.toBeInTheDocument();
  });

  it('shows on an empty new chat when a model is selected', () => {
    renderButton();
    expect(screen.getByRole('button', { name: 'Save Agent' })).toBeInTheDocument();
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
    expect(dialog).toHaveClass('bg-card-bg', 'text-text-primary');
    expect(within(dialog).getByLabelText('Agent name')).toHaveClass(
      'border-input-border',
      'bg-input-box-bg',
      'text-text-primary',
      'focus-visible:ring-focus-ring/40',
    );
    expect(within(dialog).getByLabelText('Instructions')).toHaveClass(
      'border-input-border',
      'bg-input-box-bg',
      'text-text-primary',
      'focus-visible:ring-focus-ring/40',
    );
  });

  it('opens with the latest runtime spec after flushing pending picker edits', async () => {
    const pendingFlush = deferred<undefined>();
    flushAgentSpec.mockReturnValueOnce(pendingFlush.promise);
    const rendered = renderButton();

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
    expect(within(dialog).getByLabelText('Instructions')).toHaveValue('Latest flushed instructions.');
    expect(within(dialog).getByRole('switch', { name: 'Generative UI' })).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit Connectors' }));
    const mcpDialog = await findStackedDialog('Edit Connectors');
    expect(await within(mcpDialog).findByRole('menuitemcheckbox', { name: /Slack/ })).toHaveAttribute(
      'aria-checked',
      'true',
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

  it('discards modal-only changes when closed', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save agent' });
    fireEvent.change(within(dialog).getByLabelText('Agent name'), { target: { value: 'discard-me' } });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Generative UI' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    const reopened = await screen.findByRole('dialog', { name: 'Save agent' });
    expect(within(reopened).getByLabelText('Agent name')).toHaveValue('');
    expect(within(reopened).getByRole('switch', { name: 'Generative UI' })).toHaveAttribute('aria-checked', 'true');
  });

  it('opens model editing as a stacked dialog', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    const saveDialog = await screen.findByRole('dialog', { name: 'Save agent' });
    fireEvent.click(within(saveDialog).getByRole('button', { name: 'Edit Model' }));

    const modelDialog = document.querySelectorAll('dialog')[1];
    expect(modelDialog).toBeInstanceOf(HTMLDialogElement);
    if (!(modelDialog instanceof HTMLDialogElement)) throw new Error('expected stacked model dialog');
    expect(modelDialog).toHaveAttribute('aria-label', 'Edit model');
    expect(saveDialog).toHaveAttribute('open');
    expect(modelDialog).toHaveAttribute('open');
    fireEvent.click(await within(modelDialog).findByRole('option', { name: 'claude-sonnet-4-6' }));
    expect(within(saveDialog).getByText('claude-sonnet-4-6')).toBeInTheDocument();
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
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Generative UI' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(saveAgent).toHaveBeenCalledOnce());
    expect(saveAgent).toHaveBeenCalledWith({
      agentName: 'my-agent',
      agentSpec: {
        model: { name: 'openai/gpt-4.1', params: undefined },
        instructions: 'Be helpful.',
        mcpServers: [{ id: 'github', name: 'GitHub' }],
        skills: [{ id: 'research', name: 'Research' }],
        config: {
          generativeUi: { enabled: false },
          dynamicSubAgents: { enabled: true },
          askUserQuestions: { enabled: true },
        },
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

  it('preserves opaque mount fields while adding catalog selections', async () => {
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

    fireEvent.click(within(saveDialog).getByRole('button', { name: 'Edit Connectors' }));
    const mcpDialog = await findStackedDialog('Edit Connectors');
    fireEvent.click(await within(mcpDialog).findByRole('menuitemcheckbox', { name: /Slack/ }));
    fireEvent.click(within(mcpDialog).getByRole('button', { name: 'Close' }));

    fireEvent.click(within(saveDialog).getByRole('button', { name: 'Edit Skills' }));
    const skillsDialog = await findStackedDialog('Edit skills');
    fireEvent.click(await within(skillsDialog).findByRole('menuitemcheckbox', { name: /Writing/ }));
    fireEvent.click(within(skillsDialog).getByRole('button', { name: 'Close' }));
    fireEvent.click(within(saveDialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(saveAgent).toHaveBeenCalledOnce());
    expect(saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSpec: expect.objectContaining({
          mcpServers: [
            { id: 'github', name: 'GitHub', enableTools: ['@read-only'], config: { project: 'sdk' } },
            { id: 'slack', name: 'Slack' },
          ],
          skills: [
            { id: 'research', name: 'Research', fqn: 'skills/research:1', config: { depth: 2 } },
            { id: 'writing', name: 'Writing' },
          ],
        }),
      }),
    );
  });

  it('allows unavailable selected connectors and skills to be removed', async () => {
    const saveAgent = vi.fn(async (): Promise<SaveAgentResult> => ({ agentId: 'agent-1' }));
    renderButton({
      saveAgent,
      serverOverrides: {
        getCapabilities: async () => ({
          data: {
            sandbox: { enabled: true },
            skill: { enabled: false, reason: 'Configure a sandbox provider' },
          },
        }),
        getMcp: async () => [{ id: 'github', name: 'GitHub', authenticated: false }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    const saveDialog = await screen.findByRole('dialog', { name: 'Save agent' });
    fireEvent.change(within(saveDialog).getByLabelText('Agent name'), { target: { value: 'trimmed-agent' } });

    fireEvent.click(within(saveDialog).getByRole('button', { name: 'Edit Connectors' }));
    const mcpDialog = await findStackedDialog('Edit Connectors');
    fireEvent.click(await within(mcpDialog).findByRole('menuitemcheckbox', { name: /GitHub/ }));
    fireEvent.click(within(mcpDialog).getByRole('button', { name: 'Close' }));

    fireEvent.click(within(saveDialog).getByRole('button', { name: 'Edit Skills' }));
    const skillsDialog = await findStackedDialog('Edit skills');
    fireEvent.click(await within(skillsDialog).findByRole('menuitemcheckbox', { name: /Research/ }));
    fireEvent.click(within(skillsDialog).getByRole('button', { name: 'Close' }));
    fireEvent.click(within(saveDialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(saveAgent).toHaveBeenCalledOnce());
    expect(saveAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSpec: expect.objectContaining({ mcpServers: [], skills: [] }),
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
    expect(within(dialog).getByLabelText('Instructions')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Edit Model' })).toBeDisabled();
    expect(within(dialog).getByRole('switch', { name: 'Generative UI' })).toBeDisabled();
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
