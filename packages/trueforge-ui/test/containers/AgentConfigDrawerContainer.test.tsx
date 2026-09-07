// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SaveAgentButton } from '@/atoms/SaveAgentButton.js';
import { AgentConfigInstructionsProvider } from '@/atoms/draft/AgentConfigInstructionsContext.js';
import { AgentConfigDrawerContainer } from '@/containers/AgentConfigDrawerContainer.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

const flushAgentSpec = vi.fn(async () => undefined);
const updateAgentSpec = vi.fn();

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({
    agentSpec: { model: { name: 'openai/gpt-4.1' } },
    draftSessionId: 'draft-1',
  }),
  useTrueFoundryFlushAgentSpec: () => flushAgentSpec,
  useTrueFoundryUpdateAgentSpec: () => updateAgentSpec,
  useTrueFoundryAdoptAgentSpec: () => vi.fn(),
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

beforeEach(() => {
  updateAgentSpec.mockReset();
});

function TestView({ compact = true }: { compact?: boolean }) {
  const shell = useShellMode();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          // Agent config chrome requires create-agent intent (New Agent / Edit).
          shell.openAgentBuilder();
        }}
      >
        Open config
      </button>
      <SaveAgentButton />
      <output data-testid="config-open">{String(shell.agentConfigOpen)}</output>
      {shell.agentConfigOpen ? <AgentConfigDrawerContainer showClose={compact} /> : null}
    </>
  );
}

describe('AgentConfigDrawerContainer', () => {
  it('does not close the drawer on Escape while Save Agent is open', async () => {
    render(
      <SlotsProvider>
        <ServerProvider server={createMockAgentUIServer()}>
          <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
            <AgentConfigInstructionsProvider>
              <TestView />
            </AgentConfigInstructionsProvider>
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open config' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Agent' }));
    expect(await screen.findByRole('dialog', { name: 'Save agent' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('config-open')).toHaveTextContent('true');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('config-open')).toHaveTextContent('false');
  });

  it('does not close the persistent sidebar panel on Escape', () => {
    render(
      <SlotsProvider>
        <ServerProvider server={createMockAgentUIServer()}>
          <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
            <AgentConfigInstructionsProvider>
              <TestView compact={false} />
            </AgentConfigInstructionsProvider>
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open config' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByTestId('config-open')).toHaveTextContent('true');
    expect(screen.queryByRole('button', { name: 'Close agent config' })).not.toBeInTheDocument();
  });

  it('commits drawer instructions and messages in one spec update', () => {
    render(
      <SlotsProvider>
        <ServerProvider server={createMockAgentUIServer()}>
          <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
            <AgentConfigInstructionsProvider>
              <TestView compact={false} />
            </AgentConfigInstructionsProvider>
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open config' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Instructions' }));
    fireEvent.change(screen.getByLabelText('Agent instructions'), { target: { value: 'Updated instructions' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add User Message' }));
    fireEvent.change(screen.getByLabelText('User Message 1'), { target: { value: 'Start here' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateAgentSpec).toHaveBeenCalledOnce();
    expect(updateAgentSpec).toHaveBeenCalledWith({
      model: { name: 'openai/gpt-4.1' },
      instructions: 'Updated instructions',
      messages: [{ type: 'user.message', content: 'Start here' }],
    });
  });
});
