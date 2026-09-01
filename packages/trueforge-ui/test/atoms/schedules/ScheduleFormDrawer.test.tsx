// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ScheduleFormDrawer } from '@/atoms/schedules/ScheduleFormDrawer.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentUIServer, Schedule, ScheduleServer } from '@/server/types.js';
import { createMockAgentUIServer } from '../../server/mockServer.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

function mockScheduleServer(overrides: Partial<ScheduleServer> = {}): ScheduleServer {
  return {
    listSchedules: vi.fn(async () => []),
    getSchedule: vi.fn(),
    createSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
    ...overrides,
  };
}

function renderDrawer({
  server,
  scheduleServer,
  ...props
}: Partial<ComponentProps<typeof ScheduleFormDrawer>> & {
  server?: AgentUIServer;
  scheduleServer?: ScheduleServer;
}) {
  const agentServer =
    server ??
    createMockAgentUIServer({
      searchAgents: vi.fn(async () => [{ name: 'demo-agent', agentId: 'demo-agent' }]),
    });
  const schedules = scheduleServer ?? mockScheduleServer();
  return render(
    <ServerProvider server={{ ...agentServer, schedules }}>
      <ScheduleFormDrawer open mode="create" onOpenChange={() => undefined} {...props} />
    </ServerProvider>,
  );
}

describe('ScheduleFormDrawer', () => {
  it('shows agent picker on create', async () => {
    renderDrawer({});
    const picker = await screen.findByLabelText('Agent');
    expect(picker).toBeInTheDocument();

    fireEvent.click(picker);
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'demo-agent' })).toBeInTheDocument();
    });
  });

  it('disables agent picker on edit', async () => {
    const schedule: Schedule = {
      id: 'sched-1',
      name: 'daily',
      agentId: 'demo-agent',
      agentName: 'demo-agent',
      task: 'do work',
      cron: '0 9 * * *',
      timezone: 'UTC',
      status: 'active',
      lastRunAt: null,
    };
    renderDrawer({ mode: 'edit', schedule });
    expect(await screen.findByLabelText('Agent')).toBeDisabled();
  });

  it('creates a schedule on save', async () => {
    const createSchedule = vi.fn(async () => ({
      id: 'new',
      name: 'digest',
      agentId: 'demo-agent',
      agentName: 'demo-agent',
      task: 'summarize',
      cron: '0 9 * * *',
      timezone: 'UTC',
      status: 'active' as const,
      lastRunAt: null,
    }));
    const onOpenChange = vi.fn();
    renderDrawer({
      scheduleServer: mockScheduleServer({ createSchedule }),
      onOpenChange,
      initialAgentId: 'demo-agent',
    });

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'digest' } });
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'summarize' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createSchedule).toHaveBeenCalled();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
