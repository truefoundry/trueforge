// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentConfigDrawerContainer } from '@/containers/AgentConfigDrawerContainer.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

const flushAgentSpec = vi.fn(async () => undefined);

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({
    agentSpec: { model: { name: 'openai/gpt-4.1' } },
    draftSessionId: 'draft-1',
  }),
  useTrueFoundryFlushAgentSpec: () => flushAgentSpec,
  useTrueFoundryUpdateAgentSpec: () => vi.fn(),
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

function TestView() {
  const shell = useShellMode();
  return (
    <>
      <button type="button" onClick={() => shell.setAgentConfigOpen(true)}>
        Open config
      </button>
      <output data-testid="config-open">{String(shell.agentConfigOpen)}</output>
      {shell.agentConfigOpen ? <AgentConfigDrawerContainer showClose /> : null}
    </>
  );
}

describe('AgentConfigDrawerContainer', () => {
  it('does not close the drawer on Escape while Save Agent is open', async () => {
    render(
      <SlotsProvider>
        <ServerProvider server={createMockAgentUIServer()}>
          <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
            <TestView />
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
});
