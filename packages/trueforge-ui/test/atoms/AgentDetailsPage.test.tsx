// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentDetailsPage } from '@/atoms/agent-details/AgentDetailsPage.js';
import { AgentSessions } from '@/atoms/agent-details/AgentSessions.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import type {
  AgentDetail,
  AgentMetricsServer,
  CodeSnippet,
  Session,
  SessionEventItem,
  SessionListEntry,
} from '@/server/types.js';
import { SlotsProvider, type SlotOverrides } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

const detail: AgentDetail = {
  agentId: 'agent-1',
  name: 'release-notes-writer',
  agentSpec: {
    model: { name: 'openai/gpt-5.1', params: { maxTokens: 16000 } },
    instructions: '# Who you are\n\nWrite concise release notes.',
    skills: [{ name: 'release-writing' }],
    mcpServers: [{ name: 'github' }],
  },
};

const snippets: CodeSnippet[] = [
  {
    labelName: 'TypeScript',
    language: 'typescript',
    sampleCode: { stream: 'const stream = true;', nonStream: 'const stream = false;' },
  },
];

const sessionRows: SessionListEntry[] = [
  {
    id: 'sess-1',
    title: 'Release notes draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    lastActivityAt: '2026-01-02T00:00:00.000Z',
    metrics: { totalTurns: 2, totalCostInUsd: 0.5, totalDurationMs: 120_000 },
    agentName: 'release-notes-writer',
  },
];

function deferred<T>() {
  let settle: ((value: T) => void) | undefined;
  return {
    promise: new Promise<T>(resolve => {
      settle = resolve;
    }),
    resolve(value: T) {
      settle?.(value);
    },
  };
}

function renderPage({
  getAgent = vi.fn(async () => detail),
  getCodeSnippets = vi.fn(async () => snippets),
  listSessions = vi.fn(async () => ({ data: sessionRows })),
  listSessionEvents = vi.fn(async () => ({ data: [] as SessionEventItem[] })),
  getSession = vi.fn(async (): Promise<Session> => ({
    id: 'sess-1',
    title: 'From getSession',
    isMutable: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  })),
  withSessions = true,
  metrics,
  overrides,
  initialEntries = ['/library/agent-1'],
}: {
  getAgent?: () => Promise<AgentDetail>;
  getCodeSnippets?: () => Promise<CodeSnippet[]>;
  listSessions?: () => Promise<{ data: SessionListEntry[] }>;
  listSessionEvents?: () => Promise<{ data: SessionEventItem[] }>;
  getSession?: () => Promise<Session>;
  withSessions?: boolean;
  metrics?: AgentMetricsServer;
  overrides?: SlotOverrides;
  initialEntries?: string[];
} = {}) {
  const server = createMockAgentUIServer({
    getSession,
    ...(withSessions ? { sessions: { getAgent, getCodeSnippets, listSessions, listSessionEvents } } : {}),
    ...(metrics == null ? {} : { metrics }),
  });
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <SlotsProvider overrides={overrides}>
        <ServerProvider server={server}>
          <ShellModeProvider>
            <AgentDetailsPage agentId="agent-1" />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>
    </MemoryRouter>,
  );
  return { getAgent, getCodeSnippets, listSessions, listSessionEvents, getSession };
}

describe('AgentDetailsPage', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('loads Overview and renders agent details', async () => {
    const { getAgent } = renderPage();

    expect(await screen.findByRole('heading', { name: 'release-notes-writer' })).toBeInTheDocument();
    expect(await screen.findByText('Write concise release notes.')).toBeInTheDocument();
    expect(await screen.findByText('github')).toBeInTheDocument();
    expect(await screen.findByText('release-writing')).toBeInTheDocument();
    expect(getAgent).toHaveBeenCalledTimes(1);
  });

  it('renders tab bodies through SlotProvider overrides', async () => {
    renderPage({ overrides: { AgentOverview: () => <div>Custom overview</div> } });
    expect(await screen.findByText('Custom overview')).toBeInTheDocument();
  });

  it('shows the Metrics tab when supported and renders it through slots', async () => {
    renderPage({
      metrics: {
        getCharts: vi.fn(async () => []),
        getMeters: vi.fn(async () => []),
        getChartData: vi.fn(async () => ({ step: '3600', graphs: [] })),
      },
      overrides: { AgentMetrics: () => <div>Custom metrics</div> },
    });

    fireEvent.click(await screen.findByRole('tab', { name: 'Metrics' }));
    expect(screen.getByText('Custom metrics')).toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get('tab')).toBe('metrics');
  });

  it('honors tab=metrics when the metrics port is available', async () => {
    window.history.replaceState(null, '', '/library/agent-1?tab=metrics');
    renderPage({
      initialEntries: ['/library/agent-1?tab=metrics'],
      metrics: {
        getCharts: vi.fn(async () => []),
        getMeters: vi.fn(async () => []),
        getChartData: vi.fn(async () => ({ step: '3600', graphs: [] })),
      },
      overrides: { AgentMetrics: () => <div>Metrics deep link</div> },
    });

    expect(await screen.findByRole('tab', { name: 'Metrics' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Metrics deep link')).toBeInTheDocument();
  });

  it('loads code snippets lazily and retains them across tab changes', async () => {
    const { getCodeSnippets } = renderPage();
    await screen.findByRole('heading', { name: 'release-notes-writer' });
    expect(getCodeSnippets).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Use In Code' }));
    expect(await screen.findByText('const stream = true;')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Non-stream' }));
    expect(screen.getByText('const stream = false;')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Use In Code' }));
    expect(await screen.findByText('const stream = true;')).toBeInTheDocument();
    expect(getCodeSnippets).toHaveBeenCalledTimes(1);
  });

  it('loads the Sessions tab list scoped to the agent', async () => {
    const { listSessions } = renderPage();
    await screen.findByRole('heading', { name: 'release-notes-writer' });
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }));
    expect(await screen.findByText('Release notes draft')).toBeInTheDocument();
    expect(screen.getByText('Select a session to view details')).toBeInTheDocument();
    expect(listSessions).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', order: 'desc', limit: 20 }),
    );
  });

  it('ignores a stale list response after the agent filter changes', async () => {
    const first = deferred<{ data: SessionListEntry[] }>();
    const second = deferred<{ data: SessionListEntry[] }>();
    const listSessions = vi.fn((request?: { agentId?: string }) =>
      request?.agentId === 'agent-1' ? first.promise : second.promise,
    );
    const server = createMockAgentUIServer({
      sessions: {
        getAgent: vi.fn(async () => detail),
        getCodeSnippets: vi.fn(async () => snippets),
        listSessions,
        listSessionEvents: vi.fn(async () => ({ data: [] })),
      },
    });
    const ui = (agentId: string) => (
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider>
            <AgentSessions agentId={agentId} />
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>
    );
    const view = render(ui('agent-1'));
    view.rerender(ui('agent-2'));

    await act(async () => {
      second.resolve({
        data: [
          {
            id: 'sess-2',
            title: 'Second agent session',
            createdAt: '2026-01-03T00:00:00.000Z',
            updatedAt: '2026-01-03T00:01:00.000Z',
            lastActivityAt: '2026-01-03T00:01:00.000Z',
            metrics: { totalTurns: 1, totalCostInUsd: 0, totalDurationMs: 1000 },
            agentName: 'second-agent',
          },
        ],
      });
    });
    expect(await screen.findByText('Second agent session')).toBeInTheDocument();

    await act(async () => {
      first.resolve({ data: sessionRows });
    });
    expect(screen.queryByText('Release notes draft')).not.toBeInTheDocument();
  });

  it('keeps loaded rows visible when loading another page fails', async () => {
    const listSessions = vi.fn(async (request?: { pageToken?: string }) => {
      if (request?.pageToken != null) throw new Error('network error');
      return { data: sessionRows, nextPageToken: 'next-page' };
    });
    renderPage({ listSessions });
    await screen.findByRole('heading', { name: 'release-notes-writer' });
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }));
    expect(await screen.findByText('Release notes draft')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Release notes draft')).toBeInTheDocument();
    expect(screen.queryByText('Sessions could not be loaded.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();
  });

  it('opens the Sessions tab and selected session from the share URL', async () => {
    window.history.replaceState(null, '', '/library/agent-1?sessionId=sess-1&agentId=agent-1');
    const { getSession, listSessionEvents } = renderPage({
      overrides: { AgentSessionTimelineContainer: () => <div>timeline-body</div> },
    });
    expect(await screen.findByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => {
      expect(getSession).toHaveBeenCalledWith({ sessionId: 'sess-1' });
      expect(listSessionEvents).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-1' }));
    });
    expect(screen.getByText('timeline-body')).toBeInTheDocument();
  });

  it('stays on Overview when the URL only has an unrelated chat sessionId', async () => {
    window.history.replaceState(null, '', '/library/agent-1?sessionId=chat-sess');
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'false');
  });

  it('honors tab= in the URL and writes it when the user switches tabs', async () => {
    window.history.replaceState(null, '', '/library/agent-1?tab=code&agentId=agent-1&sessionId=stale');
    const { getCodeSnippets } = renderPage();
    expect(await screen.findByRole('tab', { name: 'Use In Code' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByText('const stream = true;');
    expect(getCodeSnippets).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    const params = new URL(window.location.href).searchParams;
    expect(params.get('tab')).toBe('overview');
    expect(params.get('agentId')).toBe('agent-1');
    expect(params.get('sessionId')).toBeNull();
  });

  it('clears agent share state when Escape closes details', async () => {
    window.history.replaceState(
      null,
      '',
      '/?agentId=agent-1&tab=sessions&sessionId=sess-1&view=sessions&s_tw=2592000000',
    );
    renderPage({ initialEntries: ['/?agentId=agent-1&tab=sessions&sessionId=sess-1&view=sessions&s_tw=2592000000'] });
    await screen.findByRole('heading', { name: 'release-notes-writer' });

    fireEvent.keyDown(window, { key: 'Escape' });

    const params = new URL(window.location.href).searchParams;
    expect(params.get('agentId')).toBeNull();
    expect(params.get('tab')).toBeNull();
    expect(params.get('sessionId')).toBeNull();
    expect(params.get('view')).toBeNull();
    expect(params.get('s_tw')).toBeNull();
  });

  it('loads session metadata from getSession when a row is selected', async () => {
    const { getSession, listSessionEvents } = renderPage({
      overrides: { AgentSessionTimelineContainer: () => <div>timeline-body</div> },
    });
    await screen.findByRole('heading', { name: 'release-notes-writer' });
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }));
    fireEvent.click(await screen.findByText('Release notes draft'));
    await waitFor(() => {
      expect(getSession).toHaveBeenCalledWith({ sessionId: 'sess-1' });
      expect(listSessionEvents).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-1' }));
    });
    expect(await screen.findByText('From getSession')).toBeInTheDocument();
    expect(screen.getByText('timeline-body')).toBeInTheDocument();
  });

  it('passes session API metrics into the selected session detail', async () => {
    renderPage({
      overrides: {
        AgentSessionTimelineContainer: ({ listMetrics }) => (
          <div>{`${String(listMetrics?.totalTurns)} turns, ${String(listMetrics?.totalDurationMs)}ms, $${String(listMetrics?.totalCostInUsd)}`}</div>
        ),
      },
    });
    await screen.findByRole('heading', { name: 'release-notes-writer' });
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }));
    fireEvent.click(await screen.findByText('Release notes draft'));

    expect(await screen.findByText('2 turns, 120000ms, $0.5')).toBeInTheDocument();
  });

  it('shows the shared unavailable state without the optional server', () => {
    renderPage({ withSessions: false });
    expect(screen.getByRole('heading', { name: 'Agent details unavailable' })).toBeInTheDocument();
  });

  it('shows the shared unavailable state when loading fails', async () => {
    renderPage({ getAgent: vi.fn(async () => Promise.reject(new Error('not found'))) });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Agent details unavailable' })).toBeInTheDocument();
    });
  });
});
