// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentHistoryFilterButton } from '@/atoms/AgentHistoryFilterButton.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import type { AgentUIServer } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
});

function mockServer(partial: Partial<AgentUIServer> = {}): AgentUIServer {
  return createMockAgentUIServer({
    searchAgents: async () => [
      { name: 'From SDK', agentId: 'from-sdk' },
      { name: 'Other', agentId: 'other' },
    ],
    ...partial,
  });
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

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalShowModal === undefined) {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  } else {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  }
  if (originalClose === undefined) {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  } else {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  }
});

describe('AgentHistoryFilterButton', () => {
  it('renders nothing when library is disabled', () => {
    render(<AgentHistoryFilterButton />, {
      wrapper: wrap({ agentConfig: { mode: 'SingleAgent', name: 'locked' }, server: mockServer() }),
    });
    expect(screen.queryByRole('button', { name: /Filter chat history/i })).not.toBeInTheDocument();
  });

  it('opens popover and sets history filter on agent click', async () => {
    const searchAgents = vi.fn(async () => [
      { name: 'From SDK', agentId: 'from-sdk' },
      { name: 'Other', agentId: 'other' },
    ]);
    const server = mockServer({ searchAgents });
    render(<AgentHistoryFilterButton />, {
      wrapper: wrap({ agentConfig: { mode: 'AgentLibraryWithComposer' }, server }),
    });

    expect(screen.getByTestId('filter-value')).toHaveTextContent('all');
    expect(screen.queryByTestId('history-filter-active-dot')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Filter chat history/i }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /From SDK/i })).toBeInTheDocument());
    const menu = screen.getByRole('menu', { name: /Filter agents/i });
    expect(menu).toHaveClass('font-sans-flex');
    expect(menu.parentElement).toHaveClass('aui-theme-root');
    expect(menu.className).toContain('bg-card-bg');

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /From SDK/i }));
    });

    expect(screen.getByTestId('filter-value')).toHaveTextContent('from-sdk');
    expect(screen.getByTestId('history-filter-active-dot')).toBeInTheDocument();
    expect(searchAgents).toHaveBeenCalled();
  });

  it('hides All chats while a search query is active', async () => {
    const searchAgents = vi.fn(async (req?: { query?: string }) => {
      const q = req?.query?.trim().toLowerCase() ?? '';
      const all = [
        { name: 'From SDK', agentId: 'from-sdk' },
        { name: 'Other', agentId: 'other' },
      ];
      return q === '' ? all : all.filter(a => a.name.toLowerCase().includes(q));
    });
    const server = mockServer({ searchAgents });
    render(<AgentHistoryFilterButton />, {
      wrapper: wrap({ agentConfig: { mode: 'AgentLibraryWithComposer' }, server }),
    });

    fireEvent.click(screen.getByRole('button', { name: /Filter chat history/i }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /All chats/i })).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Search agents'), { target: { value: 'from' } });

    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: /All chats/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('menuitem', { name: /From SDK/i })).toBeInTheDocument();
  });

  it('shows an empty banner and keeps list min-height when search matches nothing', async () => {
    const searchAgents = vi.fn(async (req?: { query?: string }) => {
      const q = req?.query?.trim().toLowerCase() ?? '';
      if (q === '') return [{ name: 'From SDK', agentId: 'from-sdk' }];
      return [];
    });
    const server = mockServer({ searchAgents });
    render(<AgentHistoryFilterButton />, {
      wrapper: wrap({ agentConfig: { mode: 'AgentLibraryWithComposer' }, server }),
    });

    fireEvent.click(screen.getByRole('button', { name: /Filter chat history/i }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /From SDK/i })).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Search agents'), { target: { value: 'jjjjj' } });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('No agents match "jjjjj".');
    });
    expect(screen.queryByRole('menuitem', { name: /From SDK/i })).not.toBeInTheDocument();
    expect(screen.getByRole('menu', { name: /Filter agents/i }).querySelector('.min-h-48')).not.toBeNull();
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
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /From SDK/i })).toBeInTheDocument());
  });
});
