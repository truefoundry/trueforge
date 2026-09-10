import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';

import type { AgentMetricsServer } from '../../server/types.js';
import { createTrueForgeClient, parseIsoDate, type CreateTrueForgeClientOptions } from './client.js';

export type CreateHarnessAgentMetricsServerOptions = CreateTrueForgeClientOptions & {
  client?: TrueForge;
};

function toHarnessChartName(name: string): TrueForgeApi.SessionMetricsChartName {
  if (name === 'sessions_over_time' || name === 'sessions_cost_over_time' || name === 'turns_over_time') {
    return name;
  }
  throw new Error(`Unsupported Harness metrics chart: ${name}`);
}

export function createHarnessAgentMetricsServer(
  options: CreateHarnessAgentMetricsServerOptions = {},
): AgentMetricsServer {
  const client = options.client ?? createTrueForgeClient(options);

  return {
    async getCharts() {
      const { data } = await client.internal.metrics.listCharts();
      return data.charts;
    },
    async getMeters({ agentId, startTimestamp, endTimestamp }) {
      const { data } = await client.internal.metrics.getMeters({
        agentId,
        startTimestamp: parseIsoDate(startTimestamp),
        endTimestamp: parseIsoDate(endTimestamp),
      });
      return data.meters;
    },
    async getChartData({ agentId, startTimestamp, endTimestamp, chartName }) {
      const { data } = await client.internal.metrics.getChartData({
        agentId,
        startTimestamp: parseIsoDate(startTimestamp),
        endTimestamp: parseIsoDate(endTimestamp),
        chartName: toHarnessChartName(chartName),
      });
      return data;
    },
  };
}
