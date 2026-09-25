// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionsPage } from '@/atoms/agent-details/SessionsPage.js';
import { ToasterProvider } from '@/containers/ToasterContainer.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import type {
  ListPermissionsResponse,
  PermissionsServer,
  Session,
  SessionEventItem,
  SessionListEntry,
} from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { DEFAULT_SESSION_TIME_WINDOW_MS, SESSION_TIME_BUFFER_MS } from '@/utils/sessionShareUrl.js';
import { toDateTimeLocalValue } from '@/utils/sessionTimePresets.js';
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

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
let clipboardWriteText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clipboardWriteText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboardWriteText },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function showModal(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
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
  if (originalClipboard === undefined) {
    Reflect.deleteProperty(navigator, 'clipboard');
  } else {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  }
});

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
  deleteSession,
  permissions,
}: {
  listSessions?: (req?: ListSessionsRequest) => Promise<{ data: SessionListEntry[] }>;
  listSessionEvents?: () => Promise<{ data: SessionEventItem[] }>;
  getSession?: () => Promise<Session>;
  deleteSession?: (req: { sessionId: string }) => Promise<void>;
  permissions?: PermissionsServer;
} = {}) {
  const server = createMockAgentUIServer({
    getSession,
    searchAgents: vi.fn(async () => [
      { agentId: 'agent-1', name: 'release-notes-writer', agentSpec: { model: { name: 'openai/gpt-5.1' } } },
    ]),
    sessions: { getAgent: vi.fn(), getCodeSnippets: vi.fn(), listSessions, listSessionEvents },
    ...(deleteSession == null ? {} : { deleteSession }),
    ...(permissions == null ? {} : { permissions }),
  });
  render(
    <SlotsProvider>
      <ToasterProvider>
        <ServerProvider server={server}>
          <ShellModeProvider>
            <SessionsPage />
          </ShellModeProvider>
        </ServerProvider>
      </ToasterProvider>
    </SlotsProvider>,
  );
  return { listSessions, listSessionEvents, getSession, deleteSession };
}

describe('SessionsPage', () => {
  it('lists all user sessions without agent_id and applies the default time window', async () => {
    const { listSessions } = renderPage();
    expect(await screen.findByRole('heading', { name: 'Agent Sessions' })).toBeInTheDocument();
    expect(await screen.findByText('Named session')).toBeInTheDocument();
    expect(screen.getByText('Draft session')).toBeInTheDocument();
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize session list' })).toHaveClass('w-0');
  });

  it('labels sessions created by a schedule run', async () => {
    const scheduledRow = { ...namedRow, id: 'sess-scheduled', sourceType: 'schedule' as const };
    renderPage({ listSessions: vi.fn(async () => ({ data: [scheduledRow] })) });

    const indicator = await screen.findByLabelText('Scheduled run');
    fireEvent.mouseEnter(indicator);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Scheduled Session');
  });

  it('shows a single empty screen when there are no sessions', async () => {
    renderPage({ listSessions: vi.fn(async () => ({ data: [] })) });
    expect(await screen.findByRole('heading', { name: 'Agent Sessions' })).toBeInTheDocument();
    expect(await screen.findByText('No Sessions Found')).toBeInTheDocument();
    expect(screen.getByText('There are no sessions available at the moment.')).toBeInTheDocument();
    expect(screen.queryByText('Select a session to view details')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: 'Resize session list' })).not.toBeInTheDocument();
  });

  it('keeps the recent-sessions action when a timestamp-pinned range is empty', async () => {
    const now = Date.parse('2026-01-31T00:10:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const createdAtMs = Date.parse(namedRow.createdAt);
    window.history.replaceState(
      null,
      '',
      `/?view=sessions&s_sts=${String(createdAtMs - SESSION_TIME_BUFFER_MS)}&s_ets=${String(createdAtMs + SESSION_TIME_BUFFER_MS)}`,
    );
    const listSessions = vi.fn(async () => ({ data: [] as SessionListEntry[] }));
    renderPage({ listSessions });

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: 'Loading sessions' })).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load recent sessions' }));

    await waitFor(() => {
      expect(listSessions).toHaveBeenLastCalledWith(
        expect.objectContaining({
          startTimestamp: new Date(now - DEFAULT_SESSION_TIME_WINDOW_MS).toISOString(),
          endTimestamp: new Date(now).toISOString(),
        }),
      );
    });
  });

  it('keeps session detail visible when the list is empty but a sessionId is selected', async () => {
    window.history.replaceState(null, '', '/?view=sessions&sessionId=sess-1');
    const getSession = vi.fn(async (): Promise<Session> => ({
      id: 'sess-1',
      title: 'Pinned session',
      isMutable: false,
      createdAt: namedRow.createdAt,
      updatedAt: namedRow.updatedAt,
    }));
    renderPage({
      listSessions: vi.fn(async () => ({ data: [] })),
      getSession,
    });

    expect(await screen.findByText('Pinned session')).toBeInTheDocument();
    expect(screen.queryByText('No Sessions Found')).not.toBeInTheDocument();
    expect(getSession).toHaveBeenCalledWith({ sessionId: 'sess-1' });
  });

  it('toasts and keeps the inline failure when a non-share detail load is forbidden', async () => {
    window.history.replaceState(null, '', '/?view=sessions&sessionId=sess-1');
    const forbidden = Object.assign(new Error('Only the session creator can access this session'), {
      statusCode: 403,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderPage({
      listSessions: vi.fn(async () => ({ data: [namedRow] })),
      listSessionEvents: vi.fn(async () => {
        throw forbidden;
      }),
      getSession: vi.fn(async () => {
        throw forbidden;
      }),
    });

    expect(await screen.findByText('Session details could not be loaded.')).toBeInTheDocument();
    expect(await screen.findByText('Only the session creator can access this session')).toBeInTheDocument();
    expect(window.location.search).toContain('sessionId=sess-1');
  });

  it('copies the no-router shared-session query URL for the selected session', async () => {
    window.history.replaceState(null, '', '/?view=sessions&sessionId=sess-1&agentId=agent-1&s_tw=30');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Copy shared link' }));

    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledOnce();
    });
    const copied = new URL(String(clipboardWriteText.mock.calls[0]?.[0]));
    expect(copied.pathname).toBe('/');
    expect(copied.searchParams.get('view')).toBe('shared-session');
    expect(copied.searchParams.get('sessionId')).toBe('sess-1');
    expect(copied.searchParams.get('agentId')).toBeNull();
    expect(copied.searchParams.get('s_tw')).toBeNull();
  });

  it('shows the custom range picker only after Custom Time Range is clicked', async () => {
    renderPage();
    const timeButton = await screen.findByRole('button', { name: 'Last 30 days' });
    fireEvent.click(timeButton);
    expect(screen.getByRole('option', { name: 'Custom Time Range' })).toBeInTheDocument();
    expect(screen.queryByText('Select Time Range')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'Custom Time Range' }));
    expect(screen.getByText('Select Time Range')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });

  it('does not apply a custom range inverted by the 70-day clamp', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-31T12:00:00.000Z'));
    const listSessions = vi.fn(async () => ({ data: [namedRow, draftRow] }));
    renderPage({ listSessions });
    fireEvent.click(await screen.findByRole('button', { name: 'Last 30 days' }));
    fireEvent.click(screen.getByRole('option', { name: 'Custom Time Range' }));
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: toDateTimeLocalValue(Date.parse('2026-05-01T00:00:00.000Z')) },
    });
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: toDateTimeLocalValue(Date.parse('2026-05-02T00:00:00.000Z')) },
    });
    const requestsBeforeApply = listSessions.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(listSessions).toHaveBeenCalledTimes(requestsBeforeApply);
    expect(screen.getByText('Select Time Range')).toBeInTheDocument();
  });

  it('writes a pinned time window when a session is opened and does not require the row to be scrolled into view', async () => {
    const { listSessions } = renderPage();
    const mockedListSessions = vi.mocked(listSessions);
    const row = await screen.findByText('Named session');
    const initialListRequest = mockedListSessions.mock.calls[0]?.[0];
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
    // Pinning makes refresh/deep-link boot find the selected row, but must not
    // replace the active list filter during this mounted interaction.
    expect(mockedListSessions.mock.calls.every(([request]) => request === initialListRequest)).toBe(true);
    const resizer = screen.getByRole('separator', { name: 'Resize session list' });
    expect(resizer).toHaveClass('w-0');
    expect(resizer.querySelector('.w-px')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Named session' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load recent sessions' })).not.toBeInTheDocument();
  });

  it('loads the recent 30-day window from a timestamp-pinned session and clears its selection', async () => {
    const now = Date.parse('2026-01-31T00:10:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const createdAtMs = Date.parse(namedRow.createdAt);
    window.history.replaceState(
      null,
      '',
      `/?view=sessions&sessionId=sess-1&s_sts=${String(createdAtMs - SESSION_TIME_BUFFER_MS)}&s_ets=${String(createdAtMs + SESSION_TIME_BUFFER_MS)}`,
    );
    const { listSessions } = renderPage();

    const loadRecentButton = await screen.findByRole('button', { name: 'Load recent sessions' });
    expect(loadRecentButton.closest('aside')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close session details' }));
    expect(screen.getByRole('button', { name: 'Load recent sessions' })).toBeInTheDocument();
    fireEvent.click(loadRecentButton);

    await waitFor(() => {
      expect(listSessions).toHaveBeenLastCalledWith(
        expect.objectContaining({
          startTimestamp: new Date(now - DEFAULT_SESSION_TIME_WINDOW_MS).toISOString(),
          endTimestamp: new Date(now).toISOString(),
        }),
      );
    });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('sessionId')).toBeNull();
    expect(params.get('s_tw')).toBe(String(DEFAULT_SESSION_TIME_WINDOW_MS));
    expect(params.get('s_sts')).toBeNull();
    expect(params.get('s_ets')).toBeNull();
    expect(screen.getByText('Select a session to view details')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load recent sessions' })).not.toBeInTheDocument();
  });

  it('keeps the recent-sessions action while the narrow list range remains active', async () => {
    const createdAtMs = Date.parse(namedRow.createdAt);
    window.history.replaceState(
      null,
      '',
      `/?view=sessions&sessionId=sess-1&s_sts=${String(createdAtMs - SESSION_TIME_BUFFER_MS)}&s_ets=${String(createdAtMs + SESSION_TIME_BUFFER_MS)}`,
    );
    renderPage();

    expect(await screen.findByRole('button', { name: 'Load recent sessions' })).toBeInTheDocument();
    const row = screen.getByText('Draft session');
    fireEvent.click(row.closest('button') ?? row);

    expect(screen.getByRole('button', { name: 'Load recent sessions' })).toBeInTheDocument();
  });

  it('deletes only after the confirmation dialog is accepted', async () => {
    const deleteSession = vi.fn(async () => undefined);
    renderPage({ deleteSession });

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Named session' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(screen.getByRole('dialog', { name: 'Delete session' })).toBeInTheDocument();
    expect(deleteSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Delete session' })).not.toBeInTheDocument();
    expect(deleteSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Named session' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteSession).toHaveBeenCalledWith({ sessionId: 'sess-1' });
    });
    expect(screen.queryByText('Named session')).not.toBeInTheDocument();
    expect(screen.getByText('Draft session')).toBeInTheDocument();
  });

  it('disables Delete without session DELETE permission', async () => {
    const deleteSession = vi.fn(async () => undefined);
    renderPage({
      deleteSession,
      permissions: {
        listPermissions: vi.fn(async (): Promise<ListPermissionsResponse> => ({
          data: { type: 'session', permissions: { 'sess-1': [], 'sess-draft': ['DELETE'] } },
        })),
      },
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Named session' }));
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
    });
    expect(deleteSession).not.toHaveBeenCalled();
  });
});
