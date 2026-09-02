// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

function mockServer(
  agents: Array<{
    name: string;
    agentId: string;
    agentSpec?: {
      model: { name: string };
      description?: string;
      skills?: Array<{ id: string; name: string }>;
      mcpServers?: Array<{ id: string; name: string }>;
    };
  }> = [{ name: 'alpha-agent', agentId: 'alpha-agent' }],
): AgentUIServer {
  return createMockAgentUIServer({
    searchAgents: vi.fn(async () => agents),
  });
}

function renderLibrary(
  ui: ReactNode,
  {
    server = mockServer(),
    agentConfig,
  }: {
    server?: AgentUIServer;
    agentConfig?: Parameters<typeof ShellModeProvider>[0]['agentConfig'];
  } = {},
) {
  return render(
    <SlotsProvider>
      <ServerProvider server={server}>
        <ShellModeProvider agentConfig={agentConfig}>{ui}</ShellModeProvider>
      </ServerProvider>
    </SlotsProvider>,
  );
}

function LibraryHarness({ children, onSelectAgent }: { children?: ReactNode; onSelectAgent?: (name: string) => void }) {
  const shell = useShellMode();
  return (
    <>
      <button type="button" onClick={() => shell.setLibraryOpen(true)}>
        Open library
      </button>
      <output data-testid="library-agent-id">{shell.libraryAgentId ?? ''}</output>
      <AgentsLibrary onSelectAgent={onSelectAgent} />
      {children}
    </>
  );
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
  it('opens agent details from the row only when the optional server is available', async () => {
    window.history.replaceState(null, '', '/library?theme=dark&sessionId=stale&view=sessions&s_sts=1&s_ets=2');
    const server = createMockAgentUIServer({
      searchAgents: vi.fn(async () => [{ name: 'alpha-agent', agentId: 'agent-1' }]),
      sessions: {
        getAgent: vi.fn(),
        getCodeSnippets: vi.fn(),
        listSessions: vi.fn(async () => ({ data: [] })),
        listSessionEvents: vi.fn(async () => ({ data: [] })),
      },
    });
    renderLibrary(<LibraryHarness />, { server });
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Open alpha-agent' }));
    expect(screen.getByTestId('library-agent-id')).toHaveTextContent('agent-1');
    const params = new URL(window.location.href).searchParams;
    expect(params.get('theme')).toBe('dark');
    expect(params.get('agentId')).toBe('agent-1');
    expect(params.get('tab')).toBe('overview');
    expect(params.get('sessionId')).toBeNull();
    expect(params.get('view')).toBeNull();
    expect(params.get('s_sts')).toBeNull();
    expect(params.get('s_ets')).toBeNull();
  });

  it('lists agents and selects a named agent (Try = immutable)', async () => {
    const server = mockServer([
      { name: 'alpha-agent', agentId: 'alpha-agent' },
      { name: 'beta-agent', agentId: 'beta-agent' },
    ]);
    const onSelectAgent = vi.fn();

    renderLibrary(<LibraryHarness onSelectAgent={onSelectAgent} />, { server });

    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
    expect(screen.getByRole('heading', { name: 'Agents Library' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Try agent alpha-agent' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Try agent beta-agent' }));
    expect(onSelectAgent).toHaveBeenCalledWith('beta-agent');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Agents Library' })).not.toBeInTheDocument();
    });
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

    renderLibrary(<LibraryHarness />, {
      server,
      agentConfig: { mode: 'AgentLibraryWithComposer' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));

    const actions = await screen.findByRole('button', { name: 'Actions for writer' });
    fireEvent.click(actions);
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions for try-only' })).not.toBeInTheDocument();
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

    renderLibrary(<LibraryHarness />, {
      server,
      agentConfig: { mode: 'AgentLibraryWithComposer' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));

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

    renderLibrary(<LibraryHarness />, {
      server,
      agentConfig: { mode: 'AgentLibrary' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Try agent writer' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Actions for writer' })).not.toBeInTheDocument();
  });

  it('shows create-one guidance when there are no agents yet', async () => {
    const server = mockServer([]);

    renderLibrary(<LibraryHarness />, { server });

    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));

    await waitFor(() => {
      expect(screen.getByText('No agents yet. Build one in a chat, then save it as an agent.')).toBeInTheDocument();
    });
  });

  it('shows a no-matches message (not the create-one guidance) when a search returns nothing', async () => {
    const server = mockServer([]);

    renderLibrary(<LibraryHarness />, { server });

    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));

    fireEvent.change(screen.getByPlaceholderText('Search agents'), { target: { value: 'zzz' } });

    await waitFor(() => {
      expect(screen.getByText('No agents match "zzz".')).toBeInTheDocument();
    });
    expect(screen.queryByText('No agents yet. Build one in a chat, then save it as an agent.')).not.toBeInTheDocument();
  });

  it('closes via Escape', () => {
    renderLibrary(<LibraryHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
    expect(screen.getByRole('heading', { name: 'Agents Library' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('heading', { name: 'Agents Library' })).not.toBeInTheDocument();
  });
});

describe('AgentsLibraryButton', () => {
  it('opens the Agents Library panel from the trigger', async () => {
    const server = mockServer([{ name: 'alpha-agent', agentId: 'alpha-agent' }]);

    renderLibrary(
      <>
        <AgentsLibraryButton />
        <AgentsLibrary />
      </>,
      { server },
    );

    fireEvent.click(screen.getByRole('button', { name: /Agents Library/ }));
    expect(screen.getByRole('heading', { name: 'Agents Library' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agents Library/ })).toHaveAttribute('aria-current', 'page');
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

    renderLibrary(
      <>
        <AgentsLibraryButton />
        <Invalidate />
      </>,
      { server },
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

    renderLibrary(<AgentsLibraryButton />, { server });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Agents Library \(50\+\)/ })).toBeInTheDocument();
    });
  });

  it('does not fetch agent count when compact', () => {
    const searchAgents = vi.fn(async () => [{ name: 'alpha', agentId: 'alpha' }]);
    const server = createMockAgentUIServer({ searchAgents });

    renderLibrary(<AgentsLibraryButton compact />, { server });

    expect(screen.getByRole('button', { name: 'Agents Library' })).toBeInTheDocument();
    expect(searchAgents).not.toHaveBeenCalled();
  });

  it('shows a schedules count badge for visible agents and opens schedules on click', async () => {
    const listSchedules = vi.fn(async () => ({
      data: [
        {
          id: 's1',
          name: 'job-a',
          agentId: 'alpha-agent',
          agentName: 'alpha-agent',
          task: 't',
          cron: '0 9 * * *',
          timezone: 'UTC',
          status: 'paused' as const,
          lastRunAt: null,
        },
        {
          id: 's2',
          name: 'job-b',
          agentId: 'alpha-agent',
          agentName: 'alpha-agent',
          task: 't',
          cron: '0 10 * * *',
          timezone: 'UTC',
          status: 'active' as const,
          lastRunAt: null,
        },
      ],
    }));
    const server = createMockAgentUIServer({
      searchAgents: vi.fn(async () => [
        { name: 'alpha-agent', agentId: 'alpha-agent' },
        { name: 'beta-agent', agentId: 'beta-agent' },
      ]),
      schedules: {
        listSchedules,
        getSchedule: vi.fn(),
        createSchedule: vi.fn(),
        updateSchedule: vi.fn(),
        deleteSchedule: vi.fn(),
        listScheduleRuns: vi.fn(async () => []),
        createScheduleRun: vi.fn(),
      },
    });

    function SchedulesOpenProbe() {
      const shell = useShellMode();
      return <output data-testid="schedules-open">{shell.schedulesOpen ? 'yes' : 'no'}</output>;
    }

    renderLibrary(
      <LibraryHarness>
        <SchedulesOpenProbe />
      </LibraryHarness>,
      { server },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));

    await waitFor(() => {
      expect(listSchedules).toHaveBeenCalledWith(
        expect.objectContaining({ agentIds: ['alpha-agent', 'beta-agent'], limit: 25 }),
      );
    });

    const badge = await screen.findByRole('button', { name: /2 schedules for alpha-agent/ });
    expect(badge).toHaveTextContent('2');
    const addSchedule = screen.getByRole('button', { name: 'Add schedule for beta-agent' });
    expect(addSchedule).toHaveTextContent('-');

    fireEvent.click(addSchedule);
    expect(screen.getByTestId('schedules-open')).toHaveTextContent('yes');
    expect(new URL(window.location.href).searchParams.get('agent')).toBe('beta-agent');

    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));
    await screen.findByRole('button', { name: /2 schedules for alpha-agent/ });
    fireEvent.click(screen.getByRole('button', { name: /2 schedules for alpha-agent/ }));
    expect(new URL(window.location.href).searchParams.get('agent')).toBe('alpha-agent');
  });

  it('does not show an empty-schedules action before schedule counts load', async () => {
    let resolveSchedules: (value: { data: [] }) => void = () => undefined;
    const listSchedules = vi.fn(
      () =>
        new Promise<{ data: [] }>(resolve => {
          resolveSchedules = resolve;
        }),
    );
    const server = createMockAgentUIServer({
      searchAgents: vi.fn(async () => [{ name: 'alpha-agent', agentId: 'alpha-agent' }]),
      schedules: {
        listSchedules,
        getSchedule: vi.fn(),
        createSchedule: vi.fn(),
        updateSchedule: vi.fn(),
        deleteSchedule: vi.fn(),
        listScheduleRuns: vi.fn(async () => []),
        createScheduleRun: vi.fn(),
      },
    });

    renderLibrary(<LibraryHarness />, { server });
    fireEvent.click(screen.getByRole('button', { name: 'Open library' }));

    await screen.findByRole('button', { name: 'Try agent alpha-agent' });
    expect(screen.getByLabelText('Schedule count unavailable for alpha-agent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add schedule for alpha-agent' })).not.toBeInTheDocument();

    resolveSchedules({ data: [] });
    expect(await screen.findByRole('button', { name: 'Add schedule for alpha-agent' })).toBeInTheDocument();
  });
});
