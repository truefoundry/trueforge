// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentsLibrary } from '@/atoms/AgentsLibrary.js';
import { AgentsLibraryButton } from '@/atoms/AgentsLibraryButton.js';
import { CenteredModal } from '@/atoms/primitives/CenteredModal.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import type { AgentUIServer } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

beforeAll(() => {
  // jsdom does not implement HTMLDialogElement showModal/close.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

function mockServer(
  agents: Array<{
    name: string;
    agentId: string;
    agentSpec?: {
      model: { name: string };
      skills?: Array<{ id: string; name: string }>;
      mcpServers?: Array<{ id: string; name: string }>;
    };
  }> = [{ name: 'alpha-agent', agentId: 'alpha-agent' }],
): AgentUIServer {
  return createMockAgentUIServer({
    searchAgents: vi.fn(async () => agents),
  });
}

describe('CenteredModal', () => {
  it('opens with desktop-centered and mobile bottom-sheet classes', () => {
    render(
      <CenteredModal open onOpenChange={() => undefined} title="Demo">
        <p>body</p>
      </CenteredModal>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Demo' });
    expect(dialog).toHaveAttribute('open');
    expect(dialog.className).toContain('mt-auto');
    expect(dialog.className).toContain('md:m-auto');
    expect(dialog.className).toContain('rounded-t-xl');
    expect(dialog.className).toContain('md:rounded-xl');
    expect(dialog.className).toContain('md:max-w-5xl');
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('closes via the close button', () => {
    const onOpenChange = vi.fn();
    render(
      <CenteredModal open onOpenChange={onOpenChange} title="Demo">
        <p>body</p>
      </CenteredModal>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('AgentsLibrary', () => {
  it('lists agents and selects a named agent (Try = immutable)', async () => {
    const server = mockServer([
      { name: 'alpha-agent', agentId: 'alpha-agent' },
      { name: 'beta-agent', agentId: 'beta-agent' },
    ]);
    const onSelectAgent = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider>
            <AgentsLibrary open onOpenChange={onOpenChange} onSelectAgent={onSelectAgent} />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    expect(screen.getByRole('dialog', { name: 'Agents Library' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Try agent alpha-agent' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Try agent beta-agent' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSelectAgent).toHaveBeenCalledWith('beta-agent');
  });

  it('shows Edit when composer is enabled and agentSpec is present', async () => {
    const server = mockServer([
      {
        name: 'writer',
        agentId: 'writer-id',
        agentSpec: { model: { name: 'openai-main/gpt-4.1' }, skills: [{ id: 's1', name: 'Skill' }] },
      },
      { name: 'try-only', agentId: 'try-only' },
    ]);

    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>
            <AgentsLibrary open onOpenChange={() => undefined} />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit agent writer' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Edit agent try-only' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try agent try-only' })).toBeInTheDocument();
  });

  it('shows model name, skills count, and MCP count from agentSpec', async () => {
    const server = mockServer([
      {
        name: 'algo-art',
        agentId: 'algo-art',
        agentSpec: {
          model: { name: 'openai/gpt-5-5' },
          skills: [{ id: 's1', name: 'paint' }],
          mcpServers: [{ id: 'm1', name: 'github' }],
        },
      },
      { name: 'bare', agentId: 'bare' },
    ]);

    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>
            <AgentsLibrary open onOpenChange={() => undefined} />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('gpt-5-5')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Connectors: github')).toBeInTheDocument();
    expect(screen.getByLabelText('Skills: paint')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try agent bare' })).toBeInTheDocument();
    expect(screen.queryByLabelText('0 skills')).not.toBeInTheDocument();
  });

  it('hides Edit when composer is disabled (AgentLibrary only)', async () => {
    const server = mockServer([
      {
        name: 'writer',
        agentId: 'writer',
        agentSpec: { model: { name: 'openai-main/gpt-4.1' } },
      },
    ]);

    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider agentConfig={{ mode: 'AgentLibrary' }}>
            <AgentsLibrary open onOpenChange={() => undefined} />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Try agent writer' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Edit agent writer' })).not.toBeInTheDocument();
  });

  it('shows create-one guidance when there are no agents yet', async () => {
    const server = mockServer([]);

    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider>
            <AgentsLibrary open onOpenChange={() => undefined} />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('No agents yet. Build one in a chat, then save it as an agent.')).toBeInTheDocument();
    });
  });

  it('shows a no-matches message (not the create-one guidance) when a search returns nothing', async () => {
    const server = mockServer([]);

    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider>
            <AgentsLibrary open onOpenChange={() => undefined} />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    fireEvent.change(screen.getByPlaceholderText('Search agents'), { target: { value: 'zzz' } });

    await waitFor(() => {
      expect(screen.getByText('No agents match "zzz".')).toBeInTheDocument();
    });
    expect(screen.queryByText('No agents yet. Build one in a chat, then save it as an agent.')).not.toBeInTheDocument();
  });
});

describe('AgentsLibraryButton', () => {
  it('opens the Agents Library dialog from the trigger', async () => {
    const server = mockServer([{ name: 'alpha-agent', agentId: 'alpha-agent' }]);

    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider>
            <AgentsLibraryButton />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Agents Library/ }));
    expect(screen.getByRole('dialog', { name: 'Agents Library' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Try agent alpha-agent' })).toBeInTheDocument();
    });
  });

  it('re-fetches the agent count when agentsListEpoch bumps', async () => {
    const searchAgents = vi
      .fn()
      .mockResolvedValueOnce([{ name: 'alpha', agentId: 'alpha' }])
      .mockResolvedValueOnce([
        { name: 'alpha', agentId: 'alpha' },
        { name: 'beta', agentId: 'beta' },
      ]);
    const server = createMockAgentUIServer({ searchAgents });

    function Invalidate() {
      const shell = useShellMode();
      return (
        <button type="button" onClick={() => shell.invalidateAgentsList()}>
          Invalidate
        </button>
      );
    }

    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider>
            <AgentsLibraryButton />
            <Invalidate />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Agents Library \(1\)/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Invalidate' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Agents Library \(2\)/ })).toBeInTheDocument();
    });
    expect(searchAgents).toHaveBeenCalledTimes(2);
  });

  it('shows 50+ when the first page is full', async () => {
    const agents = Array.from({ length: 50 }, (_, i) => ({
      name: `agent-${i}`,
      agentId: `agent-${i}`,
    }));
    const server = mockServer(agents);

    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider>
            <AgentsLibraryButton />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Agents Library \(50\+\)/ })).toBeInTheDocument();
    });
  });

  it('does not fetch agent count when compact', () => {
    const searchAgents = vi.fn(async () => [{ name: 'alpha', agentId: 'alpha' }]);
    const server = createMockAgentUIServer({ searchAgents });

    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider>
            <AgentsLibraryButton compact />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    expect(screen.getByRole('button', { name: 'Agents Library' })).toBeInTheDocument();
    expect(searchAgents).not.toHaveBeenCalled();
  });
});
