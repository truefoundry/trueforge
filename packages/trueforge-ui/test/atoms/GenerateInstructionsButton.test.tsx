// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GenerateInstructionsButton } from '@/atoms/GenerateInstructionsButton.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import type { AgentSpec, AgentUIServer } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

let agentSpec: AgentSpec;
const flushAgentSpec = vi.fn(async () => undefined);
const adoptAgentSpec = vi.fn();
const generateInstructionsFromChat = vi.fn();

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({ agentSpec, draftSessionId: 'draft-1' }),
  useTrueFoundryFlushAgentSpec: () => flushAgentSpec,
  useTrueFoundryAdoptAgentSpec: () => adoptAgentSpec,
}));

vi.mock('@/assistant-ui.js', () => ({
  useAuiState: (selector: (state: { threadListItem: { remoteId?: string } }) => unknown) =>
    selector({ threadListItem: { remoteId: 'sess-1' } }),
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

function renderButton(serverOverrides: Partial<AgentUIServer> = {}) {
  const server = {
    ...createMockAgentUIServer({
      updateSession: vi.fn(async ({ agentSpec: next }) => ({
        id: 'sess-1',
        isMutable: true,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:01.000Z',
        agentSpec: next,
      })),
      ...serverOverrides,
    }),
    generateInstructionsFromChat,
  };
  return {
    server,
    ...render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
            <GenerateInstructionsButton />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    ),
  };
}

describe('GenerateInstructionsButton', () => {
  beforeEach(() => {
    agentSpec = { model: { name: 'openai/gpt-4.1' }, instructions: 'Be helpful.' };
    flushAgentSpec.mockClear();
    adoptAgentSpec.mockClear();
    generateInstructionsFromChat.mockReset();
    generateInstructionsFromChat.mockResolvedValue({
      instructions: 'Write changelog-style release notes. Never mention ticket ids.',
      currentInstructions: 'Be helpful.',
      sources: [{ turnId: 't1', role: 'user', excerpt: 'Always use a changelog.' }],
    });
  });

  it('hides when the host cannot generate instructions', () => {
    render(
      <SlotsProvider>
        <ServerProvider server={createMockAgentUIServer()}>
          <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
            <GenerateInstructionsButton />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );
    expect(screen.queryByRole('button', { name: /From chat/i })).not.toBeInTheDocument();
  });

  it('fills an editable draft and does not apply until confirmed', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /From chat/i }));

    await waitFor(() => {
      expect(generateInstructionsFromChat).toHaveBeenCalledWith({ sessionId: 'sess-1' });
    });
    const textarea = screen.getByLabelText('Suggested instructions');
    expect(textarea).toHaveValue('Write changelog-style release notes. Never mention ticket ids.');
    expect(screen.getByText(/Always use a changelog/)).toBeInTheDocument();
    expect(adoptAgentSpec).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: 'Edited instructions for this chat.' } });
    fireEvent.click(screen.getByRole('button', { name: /Apply to this chat/i }));

    await waitFor(() => {
      expect(adoptAgentSpec).toHaveBeenCalled();
    });
    expect(adoptAgentSpec.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        agentSpec: expect.objectContaining({ instructions: 'Edited instructions for this chat.' }),
      }),
    );
  });

  it('offers copy but not apply on a named-agent chat', async () => {
    const server = {
      ...createMockAgentUIServer(),
      generateInstructionsFromChat,
    };
    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'writer' }}>
            <GenerateInstructionsButton />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /From chat/i }));
    await waitFor(() => {
      expect(screen.getByLabelText('Suggested instructions')).toHaveValue(
        'Write changelog-style release notes. Never mention ticket ids.',
      );
    });
    expect(screen.queryByRole('button', { name: /Apply to this chat/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy/i })).toBeEnabled();
    expect(adoptAgentSpec).not.toHaveBeenCalled();
  });

  it('shows the server error for a short chat and leaves instructions untouched', async () => {
    generateInstructionsFromChat.mockRejectedValue(
      new Error('This chat is too short to infer durable system instructions.'),
    );
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /From chat/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/too short/i);
    });
    expect(screen.queryByRole('button', { name: /Apply to this chat/i })).toBeDisabled();
    expect(adoptAgentSpec).not.toHaveBeenCalled();
  });
});
