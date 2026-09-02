// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SchedulesPage } from '@/atoms/schedules/SchedulesPage.js';
import { ToasterProvider } from '@/containers/ToasterContainer.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentUIServer, Schedule, ScheduleRun, ScheduleServer } from '@/server/types.js';
import { createMockAgentUIServer } from '../../server/mockServer.js';

const sampleSchedules: Schedule[] = [
  {
    id: 's1',
    name: 'daily-digest',
    agentId: 'demo-agent',
    agentName: 'demo-agent',
    task: 'summarize',
    cron: '0 9 * * *',
    timezone: 'UTC',
    status: 'active',
    lastRunAt: null,
  },
];

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeEach(() => {
  window.history.replaceState(null, '', '/schedules');
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
});

function renderPage(
  schedules: Schedule[] = sampleSchedules,
  overrides: Partial<ScheduleServer> = {},
  listImpl?: ScheduleServer['listSchedules'],
  searchAgents?: AgentUIServer['searchAgents'],
) {
  const scheduleServer: ScheduleServer = {
    listSchedules: vi.fn(
      listImpl ??
        (async () => ({
          data: schedules,
        })),
    ),
    getSchedule: vi.fn(),
    createSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
    listScheduleRuns: vi.fn(async () => []),
    createScheduleRun: vi.fn(),
    ...overrides,
  };
  const server = createMockAgentUIServer({
    searchAgents: searchAgents ?? vi.fn(async () => [{ name: 'demo-agent', agentId: 'demo-agent' }]),
    schedules: scheduleServer,
  });
  render(
    <ServerProvider server={server}>
      <ToasterProvider>
        <SchedulesPage />
      </ToasterProvider>
    </ServerProvider>,
  );
  return { scheduleServer };
}

describe('SchedulesPage', () => {
  it('lists schedules in the table', async () => {
    const { scheduleServer } = renderPage();
    expect(await screen.findByRole('heading', { name: 'Scheduled Agents' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'daily-digest' })).toBeInTheDocument();
    });
    expect(screen.getAllByText('demo-agent').length).toBeGreaterThan(0);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Showing 1')).toBeInTheDocument();
    expect(scheduleServer.listSchedules).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
  });

  it('shows empty state when there are no schedules', async () => {
    renderPage([]);
    expect(await screen.findByText('No schedules yet. Create one to get started.')).toBeInTheDocument();
  });

  it('requests the next page token when Next is clicked', async () => {
    const listSchedules = vi
      .fn()
      .mockResolvedValueOnce({ data: sampleSchedules, nextPageToken: 'page-2' })
      .mockResolvedValueOnce({
        data: [
          {
            ...sampleSchedules[0],
            id: 's2',
            name: 'weekly-digest',
          },
        ],
      });
    renderPage(sampleSchedules, {}, listSchedules);

    expect(await screen.findByRole('button', { name: 'daily-digest' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() => {
      expect(listSchedules).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: 'page-2', limit: 10 }));
    });
    expect(await screen.findByRole('button', { name: 'weekly-digest' })).toBeInTheDocument();
  });

  it('ignores run history returned for a stale schedules page', async () => {
    let resolveFirstRuns: (runs: ScheduleRun[]) => void = () => undefined;
    const listSchedules = vi
      .fn()
      .mockResolvedValueOnce({ data: sampleSchedules, nextPageToken: 'page-2' })
      .mockResolvedValueOnce({
        data: [{ ...sampleSchedules[0], id: 's2', name: 'weekly-digest' }],
      });
    const listScheduleRuns = vi.fn(({ scheduleId }: { scheduleId: string }) => {
      if (scheduleId !== 's1') return Promise.resolve([]);
      return new Promise<ScheduleRun[]>(resolve => {
        resolveFirstRuns = resolve;
      });
    });
    renderPage(sampleSchedules, { listScheduleRuns }, listSchedules);

    await screen.findByRole('button', { name: 'daily-digest' });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByRole('button', { name: 'weekly-digest' })).toBeInTheDocument();

    await act(async () => {
      resolveFirstRuns([
        {
          id: 'stale-run',
          scheduleId: 's1',
          name: 'manual-stale',
          scheduledFor: '2024-06-01T10:00:00.000Z',
          status: 'failed',
          triggeredAt: '2024-06-01T10:00:01.000Z',
          triggeredBy: 'alice',
        },
      ]);
    });
    expect(screen.queryByLabelText(/Failed run at/i)).not.toBeInTheDocument();
  });

  it('filters by agent via agentIds', async () => {
    const { scheduleServer } = renderPage();
    await screen.findByRole('button', { name: 'daily-digest' });

    fireEvent.click(screen.getByRole('button', { name: 'Filter by agent' }));
    fireEvent.click(screen.getByRole('option', { name: 'demo-agent' }));

    await waitFor(() => {
      expect(scheduleServer.listSchedules).toHaveBeenCalledWith(
        expect.objectContaining({ agentIds: ['demo-agent'], limit: 10 }),
      );
    });
    expect(new URL(window.location.href).searchParams.get('agent')).toBe('demo-agent');
  });

  it('seeds filters from the URL and writes status and search to the query', async () => {
    window.history.replaceState(null, '', '/schedules?agent=demo-agent&status=paused&q=daily');
    const { scheduleServer } = renderPage([
      {
        id: 's1',
        name: 'daily-digest',
        agentId: 'demo-agent',
        agentName: 'demo-agent',
        task: 'summarize',
        cron: '0 9 * * *',
        timezone: 'UTC',
        status: 'paused',
        lastRunAt: null,
      },
    ]);

    await waitFor(() => {
      expect(scheduleServer.listSchedules).toHaveBeenCalledWith(
        expect.objectContaining({ agentIds: ['demo-agent'], limit: 10 }),
      );
    });
    expect(screen.getByPlaceholderText('Search schedules by name')).toHaveValue('daily');
    expect(screen.getByRole('button', { name: 'Filter by status' })).toHaveTextContent('Paused');

    fireEvent.change(screen.getByPlaceholderText('Search schedules by name'), {
      target: { value: 'digest' },
    });
    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('q')).toBe('digest');
    });
    expect(new URL(window.location.href).searchParams.get('status')).toBe('paused');
    expect(new URL(window.location.href).searchParams.get('agent')).toBe('demo-agent');
  });

  it('shows run history chips with tooltip labels', async () => {
    renderPage(sampleSchedules, {
      listScheduleRuns: vi.fn(async (): Promise<ScheduleRun[]> => [
        {
          id: 'run-failed',
          scheduleId: 's1',
          name: 'sched-123',
          scheduledFor: '2024-06-01T10:00:00.000Z',
          status: 'failed',
          triggeredAt: '2024-06-01T10:00:01.000Z',
          triggeredBy: 'alice',
        },
        {
          id: 'run-ok',
          scheduleId: 's1',
          name: 'manual-abc',
          scheduledFor: '2024-06-02T10:00:00.000Z',
          status: 'triggered',
          triggeredAt: '2024-06-02T10:00:01.000Z',
          triggeredBy: 'alice',
        },
        {
          id: 'run-pending',
          scheduleId: 's1',
          name: 'sched-999',
          scheduledFor: '2024-12-31T10:00:00.000Z',
          status: 'scheduled',
          triggeredAt: null,
          triggeredBy: 'alice',
        },
      ]),
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Failed run at/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Triggered run at/i)).toBeInTheDocument();
    });
  });

  it('runs a schedule now from the table actions', async () => {
    const createScheduleRun = vi.fn(async () => ({
      id: 'run-manual',
      scheduleId: 's1',
      name: 'manual-abc',
      scheduledFor: '2024-06-02T10:00:00.000Z',
      status: 'triggered' as const,
      triggeredAt: '2024-06-02T10:00:01.000Z',
      triggeredBy: 'alice',
    }));
    const listScheduleRuns = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'run-manual',
          scheduleId: 's1',
          name: 'manual-abc',
          scheduledFor: '2024-06-02T10:00:00.000Z',
          status: 'triggered' as const,
          triggeredAt: '2024-06-02T10:00:01.000Z',
          triggeredBy: 'alice',
        },
      ]);
    const { scheduleServer } = renderPage(sampleSchedules, { createScheduleRun, listScheduleRuns });

    fireEvent.click(await screen.findByRole('button', { name: 'Run now daily-digest' }));

    await waitFor(() => {
      expect(createScheduleRun).toHaveBeenCalledWith({ scheduleId: 's1' });
    });
    await waitFor(() => {
      expect(listScheduleRuns).toHaveBeenCalledTimes(2);
    });
    expect(scheduleServer.createScheduleRun).toHaveBeenCalledWith({ scheduleId: 's1' });
  });

  it('deletes only after the confirmation dialog is accepted', async () => {
    const { scheduleServer } = renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for daily-digest' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(screen.getByRole('dialog', { name: 'Delete schedule' })).toBeInTheDocument();
    expect(scheduleServer.deleteSchedule).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Delete schedule' })).not.toBeInTheDocument();
    expect(scheduleServer.deleteSchedule).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for daily-digest' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(scheduleServer.deleteSchedule).toHaveBeenCalledWith({ id: 's1' });
    });
  });

  it('toasts when pause or delete fails', async () => {
    const updateSchedule = vi.fn(async () => {
      throw new Error('pause failed');
    });
    const deleteSchedule = vi.fn(async () => {
      throw new Error('delete failed');
    });
    renderPage(sampleSchedules, { updateSchedule, deleteSchedule });

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for daily-digest' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' }));

    expect(await screen.findByText('pause failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for daily-digest' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('delete failed')).toBeInTheDocument();
  });

  it('keeps pagination when name filter matches nothing on the current page', async () => {
    renderPage(sampleSchedules, {}, async () => ({
      data: sampleSchedules,
      nextPageToken: 'page-2',
    }));

    await screen.findByRole('button', { name: 'daily-digest' });
    fireEvent.change(screen.getByPlaceholderText('Search schedules by name'), {
      target: { value: 'nope' },
    });

    expect(await screen.findByText('No schedules match your filters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('loads every page of agents for the filter', async () => {
    const agents = Array.from({ length: 51 }, (_, index) => ({
      agentId: `agent-${String(index + 1)}`,
      name: `Agent ${String(index + 1)}`,
    }));
    const searchAgents = vi.fn(async ({ limit = 50, offset = 0 } = {}) => agents.slice(offset, offset + limit));
    renderPage(sampleSchedules, {}, undefined, searchAgents);

    await waitFor(() => {
      expect(searchAgents).toHaveBeenCalledTimes(2);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Filter by agent' }));
    expect(screen.getByRole('option', { name: 'Agent 51' })).toBeInTheDocument();
  });
});
