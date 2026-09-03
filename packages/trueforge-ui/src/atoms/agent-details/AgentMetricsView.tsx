'use client';

import type { ComponentType } from 'react';

import { useSlot } from '../../theme/SlotsProvider.js';
import { Skeleton } from '../primitives/Skeleton.js';
import type { AgentMetricsViewProps } from './types.js';

export function AgentMetricsView({
  meters,
  meterError,
  charts,
  chartsLoading,
  chartsError,
  timeRange,
  onTimeRangeChange,
}: AgentMetricsViewProps) {
  const AgentMetricCard = useSlot('AgentMetricCard');
  const AgentMetricChart = useSlot('AgentMetricChart');
  const AgentMetricsTimeRangeFilter = useSlot('AgentMetricsTimeRangeFilter');

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4" data-slot="agent-metrics-view">
      <div className="mb-4 flex justify-end">
        <AgentMetricsTimeRangeFilter timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
      </div>

      {meterError != null ? (
        <div className="mb-4 rounded-lg border border-failure-bg/30 bg-failure-bg/10 p-3 text-sm text-failure-bg">
          {meterError}
        </div>
      ) : meters == null ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" aria-label="Loading metrics">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : meters.length === 0 ? (
        <div className="mb-4 rounded-lg border border-border bg-card-bg p-6 text-center text-sm text-text-secondary">
          No aggregate metrics
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {meters.map(meter => (
            <AgentMetricCard key={meter.name} meter={meter} />
          ))}
        </div>
      )}

      {chartsError != null ? (
        <div className="rounded-lg border border-failure-bg/30 bg-failure-bg/10 p-3 text-sm text-failure-bg">
          {chartsError}
        </div>
      ) : chartsLoading && charts.length === 0 ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-label="Loading metric charts">
          {Array.from({ length: 2 }, (_, index) => (
            <Skeleton key={index} className="h-80 rounded-lg" />
          ))}
        </div>
      ) : charts.length === 0 ? (
        <div className="rounded-lg border border-border bg-card-bg p-6 text-center text-sm text-text-secondary">
          No charts available
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {charts.flatMap(chart =>
            chart.graphs != null && chart.graphs.length > 0
              ? chart.graphs.map(graph => (
                  <AgentMetricChart
                    key={`${chart.definition.name}:${graph.name}`}
                    definition={chart.definition}
                    graph={graph}
                    error={chart.error}
                  />
                ))
              : [<AgentMetricChart key={chart.definition.name} definition={chart.definition} error={chart.error} />],
          )}
        </div>
      )}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentMetricsView: ComponentType<AgentMetricsViewProps>;
  }
}
