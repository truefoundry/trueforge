// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ScheduleFormDrawer } from '@/atoms/schedules/ScheduleFormDrawer.js';
import { ToasterProvider } from '@/containers/ToasterContainer.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentUIServer, ConnectorBase, Schedule, ScheduleServer } from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

const slackMcp = {
  id: 'Slack 1234',
  name: 'Slack 1234',
  authenticated: false as boolean,
};

const slackCatalogConnector: ConnectorBase = {
  id: 'Slack 1234',
  name: 'Slack 1234',
  description: '',
  url: 'https://example.com',
  auth: { type: 'dcr' },
  requiresAuth: true,
  authenticated: false,
};

function pausedSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'new',
    name: 'digest',
    agentId: 'demo-agent',
    agentName: 'demo-agent',
    task: 'summarize',
    cron: '0 9 * * *',
    timezone: 'America/New_York',
    status: 'paused',
    lastRunAt: null,
    ...overrides,
  };
}

function mockScheduleServer(overrides: Partial<ScheduleServer> = {}): ScheduleServer {
  return {
    listSchedules: vi.fn(async () => ({ data: [] })),
    getSchedule: vi.fn(),
    createSchedule: vi.fn(async () => pausedSchedule()),
    updateSchedule: vi.fn(async req =>
      pausedSchedule({ ...req, agentId: 'demo-agent', agentName: 'demo-agent', lastRunAt: null }),
    ),
    deleteSchedule: vi.fn(),
    listScheduleRuns: vi.fn(async () => []),
    createScheduleRun: vi.fn(async () => ({
      id: 'run-1',
      scheduleId: 'new',
      name: 'manual-test',
      scheduledFor: '2024-06-01T12:00:00.000Z',
      status: 'triggered' as const,
      triggeredAt: '2024-06-01T12:00:01.000Z',
      triggeredBy: 'alice',
    })),
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
      searchAgents: vi.fn(async () => [
        {
          name: 'demo-agent',
          agentId: 'demo-agent',
          agentSpec: {
            model: { name: 'openai/gpt-4.1' },
            mcpServers: [{ name: 'Slack 1234' }],
          },
        },
      ]),
      getMcp: vi.fn(async () => [slackMcp]),
      catalog: createMockCatalog({
        connectorCatalog: {
          getConnectorCatalog: async () => [],
          listConnectors: async () => [slackCatalogConnector],
          getConnector: async () => slackCatalogConnector,
          getToolsByConnectorId: async () => [],
          createConnector: vi.fn(),
          updateConnector: vi.fn(),
          authenticateConnector: vi.fn(async () => ({ status: 'AUTHENTICATED' })),
          disconnectConnector: vi.fn(),
        },
      }),
    });
  const schedules = scheduleServer ?? mockScheduleServer();
  return {
    schedules,
    ...render(
      <SlotsProvider>
        <ToasterProvider>
          <ServerProvider server={{ ...agentServer, schedules }}>
            <ScheduleFormDrawer open mode="create" onOpenChange={() => undefined} {...props} />
          </ServerProvider>
        </ToasterProvider>
      </SlotsProvider>,
    ),
  };
}

async function saveCreateForm() {
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'digest' } });
  fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'summarize' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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
    renderDrawer({ mode: 'edit', schedule: pausedSchedule({ status: 'active' }) });
    expect(await screen.findByLabelText('Agent')).toBeDisabled();
  });

  it('creates a paused schedule, stays open on the test screen, and toasts', async () => {
    const createSchedule = vi.fn(async () => pausedSchedule());
    const onOpenChange = vi.fn();
    renderDrawer({
      scheduleServer: mockScheduleServer({ createSchedule }),
      onOpenChange,
      initialAgentId: 'demo-agent',
    });

    await saveCreateForm();

    await waitFor(() => {
      expect(createSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'demo-agent',
          name: 'digest',
          task: 'summarize',
          status: 'paused',
        }),
      );
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Test Schedule' })).toBeInTheDocument();
    expect(screen.getByText('Schedule saved as paused')).toBeInTheDocument();
    expect(screen.getByText('Slack 1234')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Test' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Activate Anyway' })).toBeInTheDocument();
  });

  it('starts a test run from the test screen', async () => {
    const createScheduleRun = vi.fn(async () => ({
      id: 'run-1',
      scheduleId: 'new',
      name: 'manual-test',
      scheduledFor: '2024-06-01T12:00:00.000Z',
      status: 'triggered' as const,
      triggeredAt: '2024-06-01T12:00:01.000Z',
      triggeredBy: 'alice',
    }));
    renderDrawer({
      scheduleServer: mockScheduleServer({ createScheduleRun }),
      initialAgentId: 'demo-agent',
    });

    await saveCreateForm();
    fireEvent.click(await screen.findByRole('button', { name: 'Run Test' }));

    await waitFor(() => {
      expect(createScheduleRun).toHaveBeenCalledWith({ scheduleId: 'new' });
    });
    expect(screen.getByText('Test run started')).toBeInTheDocument();
    expect(screen.getByText('Manual test')).toBeInTheDocument();
  });

  it('edits a created schedule without creating a duplicate', async () => {
    const createSchedule = vi.fn(async () => pausedSchedule());
    const updateSchedule = vi.fn(async req =>
      pausedSchedule({
        id: req.id,
        name: req.name,
        task: req.task,
        cron: req.cron,
        timezone: req.timezone,
        status: req.status,
      }),
    );
    renderDrawer({
      scheduleServer: mockScheduleServer({ createSchedule, updateSchedule }),
      initialAgentId: 'demo-agent',
    });

    await saveCreateForm();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Configuration' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'digest-v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'new',
          name: 'digest-v2',
          status: 'paused',
        }),
      );
    });
    expect(createSchedule).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: 'Test Schedule' })).toBeInTheDocument();
    expect(screen.getByText('digest-v2')).toBeInTheDocument();
  });

  it('connects an MCP and refreshes its status', async () => {
    const authenticateConnector = vi.fn(async () => ({ status: 'AUTHENTICATED' }));
    let authenticated = false;
    const getMcp = vi.fn(async () => [{ ...slackMcp, authenticated }]);
    renderDrawer({
      server: createMockAgentUIServer({
        searchAgents: vi.fn(async () => [
          {
            name: 'demo-agent',
            agentId: 'demo-agent',
            agentSpec: {
              model: { name: 'openai/gpt-4.1' },
              mcpServers: [{ name: 'Slack 1234' }],
            },
          },
        ]),
        getMcp,
        catalog: createMockCatalog({
          connectorCatalog: {
            getConnectorCatalog: async () => [],
            listConnectors: async () => [{ ...slackCatalogConnector, authenticated }],
            getConnector: async () => ({ ...slackCatalogConnector, authenticated }),
            getToolsByConnectorId: async () => [],
            createConnector: vi.fn(),
            updateConnector: vi.fn(),
            authenticateConnector,
            disconnectConnector: vi.fn(),
          },
        }),
      }),
      initialAgentId: 'demo-agent',
    });

    await saveCreateForm();
    const connect = await screen.findByRole('button', { name: 'Connect Slack 1234' });
    authenticated = true;
    fireEvent.click(connect);

    await waitFor(() => {
      expect(authenticateConnector).toHaveBeenCalled();
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });
  });

  it('activates the schedule and closes the drawer', async () => {
    const updateSchedule = vi.fn(async req =>
      pausedSchedule({ ...req, status: 'active', lastRunAt: null, agentId: 'demo-agent', agentName: 'demo-agent' }),
    );
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    renderDrawer({
      scheduleServer: mockScheduleServer({ updateSchedule }),
      onOpenChange,
      onSaved,
      initialAgentId: 'demo-agent',
    });

    await saveCreateForm();
    fireEvent.click(await screen.findByRole('button', { name: 'Activate Anyway' }));

    await waitFor(() => {
      expect(updateSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'new',
          status: 'active',
        }),
      );
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes after an external edit save', async () => {
    const updateSchedule = vi.fn(async req =>
      pausedSchedule({
        id: req.id,
        name: req.name,
        task: req.task,
        cron: req.cron,
        timezone: req.timezone,
        status: req.status,
      }),
    );
    const onOpenChange = vi.fn();
    renderDrawer({
      mode: 'edit',
      schedule: pausedSchedule({ status: 'active' }),
      scheduleServer: mockScheduleServer({ updateSchedule }),
      onOpenChange,
    });

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateSchedule).toHaveBeenCalledWith(expect.objectContaining({ name: 'renamed', status: 'active' }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('heading', { name: 'Test Schedule' })).not.toBeInTheDocument();
  });
});
