// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ServerProvider } from '../server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '../server/ShellModeContext.js';
import type { AgentUIServer } from '../server/types.js';
import { SlotsProvider } from '../theme/SlotsProvider.js';
import { AgentHistoryFilterButton } from './AgentHistoryFilterButton.js';

HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
};

function mockServer(partial: Partial<AgentUIServer> = {}): AgentUIServer {
  return {
    searchAgents: vi.fn().mockResolvedValue([{ name: 'from-sdk' }, { name: 'other' }]),
    ...partial,
  } as AgentUIServer;
}

function FilterProbe() {
  const shell = useShellMode();
  return <span data-testid="filter-value">{shell.historyAgentFilter ?? 'all'}</span>;
}

function wrap({
  agentConfig,
  server,
}: {
  agentConfig?: Parameters<typeof ShellModeProvider>[0]['agentConfig'];
  server?: AgentUIServer | null;
}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const tree = (
      <SlotsProvider>
        <ShellModeProvider agentConfig={agentConfig}>
          {children}
          <FilterProbe />
        </ShellModeProvider>
      </SlotsProvider>
    );
    if (server == null) return tree;
    return <ServerProvider server={server}>{tree}</ServerProvider>;
  };
}

describe('AgentHistoryFilterButton', () => {
  it('renders nothing when library is disabled', () => {
    render(<AgentHistoryFilterButton />, {
      wrapper: wrap({ agentConfig: { mode: 'SingleAgent', name: 'locked' }, server: mockServer() }),
    });
    expect(screen.queryByRole('button', { name: /Filter chat history/i })).not.toBeInTheDocument();
  });

  it('opens popover and sets history filter on agent click', async () => {
    const server = mockServer();
    render(<AgentHistoryFilterButton />, {
      wrapper: wrap({ agentConfig: { mode: 'AgentLibraryWithComposer' }, server }),
    });

    expect(screen.getByTestId('filter-value')).toHaveTextContent('all');

    fireEvent.click(screen.getByRole('button', { name: /Filter chat history/i }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /from-sdk/i })).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /from-sdk/i }));
    });

    expect(screen.getByTestId('filter-value')).toHaveTextContent('from-sdk');
    expect(server.searchAgents).toHaveBeenCalled();
  });

  it('opens a bottom sheet on mobile', async () => {
    const matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }));
    vi.stubGlobal('matchMedia', matchMedia);

    const server = mockServer();
    render(<AgentHistoryFilterButton />, {
      wrapper: wrap({ agentConfig: { mode: 'AgentLibraryWithComposer' }, server }),
    });

    fireEvent.click(screen.getByRole('button', { name: /Filter chat history/i }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Filter agents/i })).toBeInTheDocument();
    });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /from-sdk/i })).toBeInTheDocument());

    vi.unstubAllGlobals();
  });
});
