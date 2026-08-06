// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ServerProvider } from '../server/ServerContext.js';
import { ShellModeProvider } from '../server/ShellModeContext.js';
import type { AgentUIServer } from '../server/types.js';
import { SlotsProvider } from '../theme/SlotsProvider.js';
import { SaveAgentButton } from './SaveAgentButton.js';

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

function mockServer(saveAgent = vi.fn(async () => ({ ok: true }))): AgentUIServer {
  return { saveAgent } as unknown as AgentUIServer;
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

    expect(screen.queryByRole('button', { name: 'Save as agent' })).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Save as agent' }));
    const dialog = screen.getByRole('dialog', { name: 'Save as agent' });
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
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(saveAgent).toHaveBeenCalledWith({
        agentName: 'my-agent',
        agentSpec: {
          model: { name: 'openai-main/gpt-4.1' },
          skills: [{ id: 's1', name: 'Skill One' }],
          instructions: 'You write release notes.',
        },
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Save as agent' })).not.toBeInTheDocument();
    });
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

    fireEvent.click(screen.getByRole('button', { name: 'Save as agent' }));
    const dialog = screen.getByRole('dialog', { name: 'Save as agent' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'dup' } });
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);

    await waitFor(() => {
      expect(screen.getByText('Name taken')).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog', { name: 'Save as agent' })).toBeInTheDocument();
  });
});
