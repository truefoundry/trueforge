// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionsPage } from '@/atoms/agent-details/SessionsPage.js';
import { DEFAULT_SESSION_TIME_WINDOW_MS, SESSION_TIME_BUFFER_MS } from '@/utils/sessionShareUrl.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import type { Session, SessionEventItem, SessionListEntry } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

const namedRow: SessionListEntry = {
  id: 'sess-1',
  title: 'Named session',
  createdAt: '2026-01-01T00:10:00.000Z',
  updatedAt: '2026-01-01T00:12:00.000Z',
  lastActivityAt: '2026-01-01T00:12:00.000Z',
  metrics: { totalTurns: 1, totalCostInUsd: 0, totalDurationMs: 1000 },
  agentName: 'release-notes-writer',
};

const draftRow: SessionListEntry = {
  id: 'sess-draft',
  title: 'Draft session',
  createdAt: '2026-01-01T00:11:00.000Z',
  updatedAt: '2026-01-01T00:11:30.000Z',
  lastActivityAt: '2026-01-01T00:11:30.000Z',
  metrics: { totalTurns: 1, totalCostInUsd: 0, totalDurationMs: 500 },
};

type ListSessionsRequest = {
  agentId?: string;
  startTimestamp?: string;
  endTimestamp?: string;
};

function renderPage({
  listSessions = vi.fn(async (_req?: ListSessionsRequest) => ({ data: [namedRow, draftRow] })),
  listSessionEvents = vi.fn(async () => ({ data: [] as SessionEventItem[] })),
  getSession = vi.fn(async (): Promise<Session> => ({
    id: 'sess-1',
    title: 'Named session',
    isMutable: false,
    createdAt: namedRow.createdAt,
    updatedAt: namedRow.updatedAt,
  })),
}: {
  listSessions?: (req?: ListSessionsRequest) => Promise<{ data: SessionListEntry[] }>;
  listSessionEvents?: () => Promise<{ data: SessionEventItem[] }>;
  getSession?: () => Promise<Session>;
} = {}) {
  const server = createMockAgentUIServer({
    getSession,
    searchAgents: vi.fn(async () => [{ agentId: 'agent-1', name: 'release-notes-writer', agentSpec: { model: { name: 'openai/gpt-5.1' } } }]),
    sessions: { getAgent: vi.fn(), getCodeSnippets: vi.fn(), listSessions, listSessionEvents },
  });
  render(
    <SlotsProvider>
      <ServerProvider server={server}>
        <ShellModeProvider>
          <SessionsPage />
        </ShellModeProvider>
      </ServerProvider>
    </SlotsProvider>,
  );
  return { listSessions, listSessionEvents, getSession };
}

describe('SessionsPage', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('lists all user sessions without agent_id and applies the default time window', async () => {
    const { listSessions } = renderPage();
    expect(await screen.findByRole('heading', { name: 'Agent Sessions' })).toBeInTheDocument();
    expect(await screen.findByText('Named session')).toBeInTheDocument();
    expect(screen.getByText('Draft session')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(listSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        order: 'desc',
        limit: 20,
        startTimestamp: expect.any(String),
        endTimestamp: expect.any(String),
      }),
    );
    const request = vi.mocked(listSessions).mock.calls[0]?.[0];
    expect(request).toEqual(
      expect.objectContaining({
        startTimestamp: expect.any(String),
        endTimestamp: expect.any(String),
      }),
    );
    expect(request?.agentId).toBeUndefined();
    expect(request?.startTimestamp).toBeDefined();
    expect(request?.endTimestamp).toBeDefined();
    if (request?.startTimestamp == null || request.endTimestamp == null) {
      throw new Error('expected listSessions time bounds');
    }
    expect(Date.parse(request.endTimestamp) - Date.parse(request.startTimestamp)).toBe(DEFAULT_SESSION_TIME_WINDOW_MS);
    expect(window.location.search).toContain('view=sessions');
  });

  it('writes a pinned time window when a session is opened and does not require the row to be scrolled into view', async () => {
    renderPage();
    const row = await screen.findByText('Named session');
    fireEvent.click(row.closest('button') ?? row);
    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get('sessionId')).toBe('sess-1');
      expect(params.get('view')).toBe('sessions');
      expect(params.get('s_tw')).toBeNull();
      const createdAtMs = Date.parse(namedRow.createdAt);
      expect(params.get('s_sts')).toBe(String(createdAtMs - SESSION_TIME_BUFFER_MS));
      expect(params.get('s_ets')).toBe(String(createdAtMs + SESSION_TIME_BUFFER_MS));
    });
    expect(screen.getByRole('heading', { name: 'Named session' })).toBeInTheDocument();
  });
});
