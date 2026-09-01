// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SchedulesPage } from '@/atoms/schedules/SchedulesPage.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { Schedule, ScheduleServer } from '@/server/types.js';
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

function renderPage(schedules: Schedule[] = sampleSchedules, listImpl?: ScheduleServer['listSchedules']) {
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
  };
  const server = createMockAgentUIServer({
    searchAgents: vi.fn(async () => [{ name: 'demo-agent', agentId: 'demo-agent' }]),
    schedules: scheduleServer,
  });
  render(
    <ServerProvider server={server}>
      <SchedulesPage />
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
    expect(screen.getByText('Never')).toBeInTheDocument();
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
    renderPage(sampleSchedules, listSchedules);

    expect(await screen.findByRole('button', { name: 'daily-digest' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() => {
      expect(listSchedules).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: 'page-2', limit: 10 }));
    });
    expect(await screen.findByRole('button', { name: 'weekly-digest' })).toBeInTheDocument();
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
        ...sampleSchedules[0],
        status: 'paused',
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
});
