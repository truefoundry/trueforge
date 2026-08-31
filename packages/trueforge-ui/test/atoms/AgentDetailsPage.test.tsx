// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentDetailsPage } from '@/atoms/agent-details/AgentDetailsPage.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import type { AgentDetail, CodeSnippet, Session, SessionEventItem, SessionListEntry } from '@/server/types.js';
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
  overrides,
  initialEntries = ['/library/agent-1'],
}: {
  getAgent?: () => Promise<AgentDetail>;
  getCodeSnippets?: () => Promise<CodeSnippet[]>;
  listSessions?: () => Promise<{ data: SessionListEntry[] }>;
  listSessionEvents?: () => Promise<{ data: SessionEventItem[] }>;
  getSession?: () => Promise<Session>;
  withSessions?: boolean;
  overrides?: SlotOverrides;
  initialEntries?: string[];
} = {}) {
  const server = createMockAgentUIServer({
    getSession,
    ...(withSessions ? { sessions: { getAgent, getCodeSnippets, listSessions, listSessionEvents } } : {}),
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
