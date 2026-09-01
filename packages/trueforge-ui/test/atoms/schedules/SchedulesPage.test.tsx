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

function renderPage(schedules: Schedule[] = sampleSchedules) {
  const scheduleServer: ScheduleServer = {
    listSchedules: vi.fn(async () => schedules),
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
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Scheduled Agents' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'daily-digest' })).toBeInTheDocument();
    });
    expect(screen.getAllByText('demo-agent').length).toBeGreaterThan(0);
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–1 of 1')).toBeInTheDocument();
  });

  it('shows empty state when there are no schedules', async () => {
    renderPage([]);
    expect(await screen.findByText('No schedules yet. Create one to get started.')).toBeInTheDocument();
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
