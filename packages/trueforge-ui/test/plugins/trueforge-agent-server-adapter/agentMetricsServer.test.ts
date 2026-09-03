import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import { createHarnessAgentMetricsServer } from '@/plugins/trueforge-agent-server-adapter/agentMetricsServer.js';

const range = {
  agentId: 'agent-1',
  startTimestamp: '2026-08-27T13:00:00.000Z',
  endTimestamp: '2026-08-28T13:00:00.000Z',
};

describe('createHarnessAgentMetricsServer', () => {
  it('maps charts, meters, and chart data to the UI contract', async () => {
    const fetch = vi.fn(async (input: Request | string | URL) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const path = url.pathname;
      if (path === '/api/internal/metrics/charts') {
        return Response.json({
          data: {
            charts: [
              {
                name: 'sessions_over_time',
                display_name: 'Sessions',
                description: 'Session starts over time',
                chart_type: 'line',
              },
            ],
          },
        });
      }
      if (path === '/api/internal/metrics/meters') {
        return Response.json({
          data: {
            meters: [
              {
                name: 'total_cost_in_usd',
                aggregate_value: 1.248,
                description: 'Total cost',
                unit: '$',
              },
            ],
          },
        });
      }
      return Response.json({
        data: {
          step: '3600',
          graphs: [
            {
              name: 'sessions_over_time',
              display_name: 'Sessions per hour',
              description: 'How many sessions started each hour',
              unit: 'count',
              chart_type: 'line',
              graph_lines: [
                {
                  name: 'sessions',
                  values: [{ timestamp: '2026-08-27T15:00:00.000Z', value: 2 }],
                },
              ],
            },
          ],
        },
      });
    });
    const server = createHarnessAgentMetricsServer({ baseUrl: 'https://trueforge.example', fetch });

    assert.deepEqual(await server.getCharts(), [
      {
        name: 'sessions_over_time',
        displayName: 'Sessions',
        description: 'Session starts over time',
        chartType: 'line',
      },
    ]);
    assert.deepEqual(await server.getMeters(range), [
      {
        name: 'total_cost_in_usd',
        aggregateValue: 1.248,
        description: 'Total cost',
        unit: '$',
      },
    ]);
    assert.deepEqual(
      await server.getChartData({
        ...range,
        chartName: 'sessions_over_time',
      }),
      {
        step: '3600',
        graphs: [
          {
            name: 'sessions_over_time',
            displayName: 'Sessions per hour',
            description: 'How many sessions started each hour',
            unit: 'count',
            chartType: 'line',
            graphLines: [
              {
                name: 'sessions',
                values: [{ timestamp: '2026-08-27T15:00:00.000Z', value: 2 }],
              },
            ],
          },
        ],
      },
    );

    const meterInput = fetch.mock.calls[1]?.[0];
    const meterUrl = new URL(meterInput instanceof Request ? meterInput.url : String(meterInput));
    assert.equal(meterUrl.pathname, '/api/internal/metrics/meters');
    assert.deepEqual(Object.fromEntries(meterUrl.searchParams), {
      agent_id: 'agent-1',
      start_timestamp: range.startTimestamp,
      end_timestamp: range.endTimestamp,
    });
    const chartInput = fetch.mock.calls[2]?.[0];
    const chartUrl = new URL(chartInput instanceof Request ? chartInput.url : String(chartInput));
    assert.deepEqual(Object.fromEntries(chartUrl.searchParams), {
      agent_id: 'agent-1',
      start_timestamp: range.startTimestamp,
      end_timestamp: range.endTimestamp,
      chart_name: 'sessions_over_time',
    });
  });

  it('reports non-success response bodies', async () => {
    const server = createHarnessAgentMetricsServer({
      baseUrl: 'https://trueforge.example',
      fetch: vi.fn(async () => Response.json({ error: { message: 'metrics unavailable' } }, { status: 503 })),
    });

    await assert.rejects(
      server.getCharts(),
      error =>
        error instanceof Error &&
        'statusCode' in error &&
        error.statusCode === 503 &&
        'body' in error &&
        JSON.stringify(error.body).includes('metrics unavailable'),
    );
  });
});
