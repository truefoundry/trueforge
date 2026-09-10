// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentMetricsContainer } from '@/containers/AgentMetricsContainer.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type {
  AgentMetricChartData,
  AgentMetricChartDataRequest,
  AgentMetricChartDefinition,
  AgentMetricRangeRequest,
  AgentMetricsServer,
} from '@/server/types.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { createMockAgentUIServer } from '../server/mockServer.js';

const definitions: AgentMetricChartDefinition[] = [
  {
    name: 'sessions_over_time',
    displayName: 'Sessions',
    description: 'Session starts over time',
    chartType: 'line',
  },
];

function renderMetrics(metrics: AgentMetricsServer) {
  render(
    <SlotsProvider
      overrides={{
        AgentMetricChart: ({ graph, definition, error }) => (
          <div>
            {error ?? `${definition.displayName}: ${String(graph?.graphLines[0]?.values[0]?.value ?? 'empty')}`}
          </div>
        ),
        AgentMetricsTimeRangeFilter: ({ onTimeRangeChange }) => (
          <button
            type="button"
            onClick={() =>
              onTimeRangeChange({
                startTs: Date.parse('2026-08-20T00:00:00.000Z'),
                endTs: Date.parse('2026-08-21T00:00:00.000Z'),
              })
            }
          >
            Set custom range
          </button>
        ),
      }}
    >
      <ServerProvider server={createMockAgentUIServer({ metrics })}>
        <AgentMetricsContainer agentId="agent-1" />
      </ServerProvider>
    </SlotsProvider>,
  );
}

describe('AgentMetricsContainer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-28T13:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the default 24-hour range and reloads a custom range', async () => {
    const getMeters = vi.fn(async (_request: AgentMetricRangeRequest) => [
      { name: 'total_sessions', aggregateValue: 12, description: 'Total sessions', unit: 'count' },
      { name: 'total_cost', aggregateValue: 1.248, description: 'Total cost', unit: '$' },
    ]);
    const getChartData = vi.fn(async (_request: AgentMetricChartDataRequest): Promise<AgentMetricChartData> => ({
      step: '3600',
      graphs: [
        {
          name: 'sessions_over_time',
          displayName: 'Sessions per hour',
          description: 'Sessions each hour',
          unit: 'count',
          chartType: 'line',
          graphLines: [
            {
              name: 'sessions',
              values: [{ timestamp: '2026-08-28T12:00:00.000Z', value: 4 }],
            },
          ],
        },
      ],
    }));
    renderMetrics({
      getCharts: vi.fn(async () => definitions),
      getMeters,
      getChartData,
    });

    expect(await screen.findByText('Total sessions')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('$1.2480')).toBeInTheDocument();
    expect(await screen.findByText('Sessions: 4')).toBeInTheDocument();
    const defaultRequest = getMeters.mock.calls[0]?.[0];
    expect(defaultRequest?.agentId).toBe('agent-1');
    expect(Date.parse(defaultRequest?.endTimestamp ?? '') - Date.parse(defaultRequest?.startTimestamp ?? '')).toBe(
      24 * 60 * 60 * 1000,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set custom range' }));
    await waitFor(() => expect(getMeters).toHaveBeenCalledTimes(2));
    expect(getChartData).toHaveBeenLastCalledWith({
      agentId: 'agent-1',
      startTimestamp: '2026-08-20T00:00:00.000Z',
      endTimestamp: '2026-08-21T00:00:00.000Z',
      chartName: 'sessions_over_time',
    });
  });

  it('shows empty states when the server returns no metrics', async () => {
    renderMetrics({
      getCharts: vi.fn(async () => []),
      getMeters: vi.fn(async () => []),
      getChartData: vi.fn(async () => ({ step: '3600', graphs: [] })),
    });

    expect(await screen.findByText('No aggregate metrics')).toBeInTheDocument();
    expect(screen.getByText('No charts available')).toBeInTheDocument();
  });
});
