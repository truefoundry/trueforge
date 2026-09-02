'use client';

import { useEffect, useState, type ComponentType } from 'react';

import type { AgentMetricChartResult, AgentMetricsProps } from '../atoms/agent-details/types.js';
import { useAgentMetricsServer } from '../server/ServerContext.js';
import type { AgentMetricChartDefinition, AgentMetricMeter } from '../server/types.js';
import { useSlot } from '../theme/SlotsProvider.js';
import { getErrorMessage } from '../utils/getErrorMessage.js';
import { resolveSessionTimeRange, type SessionTimeRange } from '../utils/sessionShareUrl.js';

const DEFAULT_METRICS_WINDOW_MS = 24 * 60 * 60 * 1000;

export function AgentMetricsContainer({ agentId }: AgentMetricsProps) {
  const metricsServer = useAgentMetricsServer();
  const AgentMetricsView = useSlot('AgentMetricsView');
  const [timeRange, setTimeRange] = useState<SessionTimeRange>(() => {
    const endTs = Date.now();
    return {
      startTs: endTs - DEFAULT_METRICS_WINDOW_MS,
      endTs,
      timeWindowMs: DEFAULT_METRICS_WINDOW_MS,
    };
  });
  const [definitions, setDefinitions] = useState<AgentMetricChartDefinition[]>();
  const [chartsError, setChartsError] = useState<string>();
  const [meters, setMeters] = useState<AgentMetricMeter[]>();
  const [meterError, setMeterError] = useState<string>();
  const [charts, setCharts] = useState<AgentMetricChartResult[]>([]);
  const [chartsLoading, setChartsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setDefinitions(undefined);
    setChartsError(undefined);
    void metricsServer.getCharts().then(
      result => {
        if (!cancelled) setDefinitions(result);
      },
      error => {
        if (!cancelled) {
          setDefinitions([]);
          setChartsError(getErrorMessage(error, 'Metric charts could not be loaded.'));
          setChartsLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [metricsServer]);

  useEffect(() => {
    if (definitions == null) return undefined;
    let cancelled = false;
    const resolvedRange = resolveSessionTimeRange(timeRange);
    const request = {
      agentId,
      startTimestamp: new Date(resolvedRange.startTs).toISOString(),
      endTimestamp: new Date(resolvedRange.endTs).toISOString(),
    };

    setMeters(undefined);
    setMeterError(undefined);
    setCharts(definitions.map(definition => ({ definition })));
    setChartsLoading(true);

    void metricsServer.getMeters(request).then(
      result => {
        if (!cancelled) setMeters(result);
      },
      error => {
        if (!cancelled) setMeterError(getErrorMessage(error, 'Aggregate metrics could not be loaded.'));
      },
    );

    void Promise.all(
      definitions.map(async definition => {
        try {
          const data = await metricsServer.getChartData({
            ...request,
            chartName: definition.name,
          });
          return { definition, graphs: data.graphs } satisfies AgentMetricChartResult;
        } catch (error) {
          return {
            definition,
            error: getErrorMessage(error, `${definition.displayName} could not be loaded.`),
          } satisfies AgentMetricChartResult;
        }
      }),
    ).then(result => {
      if (!cancelled) {
        setCharts(result);
        setChartsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [agentId, definitions, metricsServer, timeRange]);

  return (
    <AgentMetricsView
      meters={meters}
      meterError={meterError}
      charts={charts}
      chartsLoading={chartsLoading}
      chartsError={chartsError}
      timeRange={timeRange}
      onTimeRangeChange={setTimeRange}
    />
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentMetrics: ComponentType<AgentMetricsProps>;
  }
}
