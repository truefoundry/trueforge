'use client';

import type { ComponentType } from 'react';

import type { AgentMetricMeter } from '../../server/types.js';
import { useSlot } from '../../theme/SlotsProvider.js';
import { Skeleton } from '../primitives/Skeleton.js';
import type { AgentMetricChartProps, AgentMetricStatisticsProps, AgentMetricsViewProps } from './types.js';

const featuredMetricNames = ['total_cost_in_usd', 'cost_per_session_in_usd', 'total_sessions', 'avg_turns_per_session'];
const statisticMetricNames = new Set([
  'total_turns',
  'min_turns_per_session',
  'median_turns_per_session',
  'max_turns_per_session',
  'min_session_duration_ms',
  'median_session_duration_ms',
  'p95_session_duration_ms',
  'max_session_duration_ms',
]);
const statisticNumberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });

function formatStatisticValue({
  meter,
  durationInSeconds,
}: {
  meter: AgentMetricMeter | undefined;
  durationInSeconds: boolean;
}): string {
  if (meter == null) return '—';
  return statisticNumberFormatter.format(durationInSeconds ? meter.aggregateValue / 1_000 : meter.aggregateValue);
}

export function AgentMetricStatistics({ meters }: AgentMetricStatisticsProps) {
  const metersByName = new Map(meters.map(meter => [meter.name, meter]));
  const sections = [
    {
      ariaLabel: 'Turn statistics',
      gridClassName: 'grid-cols-4',
      durationInSeconds: false,
      items: [
        { label: 'Total turns', meter: metersByName.get('total_turns'), prominent: true, highlighted: false },
        { label: 'Min', meter: metersByName.get('min_turns_per_session'), prominent: false, highlighted: false },
        { label: 'Median', meter: metersByName.get('median_turns_per_session'), prominent: false, highlighted: true },
        { label: 'Max', meter: metersByName.get('max_turns_per_session'), prominent: false, highlighted: false },
      ],
    },
    {
      ariaLabel: 'Duration statistics',
      gridClassName: 'grid-cols-5',
      durationInSeconds: true,
      items: [
        {
          label: 'Duration (s)',
          meter: metersByName.get('median_session_duration_ms'),
          prominent: true,
          highlighted: false,
        },
        { label: 'Min', meter: metersByName.get('min_session_duration_ms'), prominent: false, highlighted: false },
        {
          label: 'Median',
          meter: metersByName.get('median_session_duration_ms'),
          prominent: false,
          highlighted: true,
        },
        { label: 'P95', meter: metersByName.get('p95_session_duration_ms'), prominent: false, highlighted: true },
        { label: 'Max', meter: metersByName.get('max_session_duration_ms'), prominent: false, highlighted: false },
      ],
    },
  ].filter(section => section.items.some(item => item.meter != null));

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-slot="agent-metric-statistics">
      {sections.map(section => (
        <section
          key={section.ariaLabel}
          aria-label={section.ariaLabel}
          className="min-w-0 rounded-xl border border-border bg-card-bg p-4 shadow-sm"
        >
          <dl className={`grid ${section.gridClassName} divide-x divide-border`}>
            {section.items.map(item => {
              const value = formatStatisticValue({
                meter: item.meter,
                durationInSeconds: section.durationInSeconds,
              });
              return (
                <div key={item.label} className="min-w-0 px-3 first:pl-0 last:pr-0">
                  <dt className="truncate text-xs font-medium text-text-secondary">{item.label}</dt>
                  <dd
                    className={`mt-1 truncate font-semibold tabular-nums ${
                      item.prominent ? 'text-xl' : 'text-base'
                    } ${item.highlighted ? 'text-primary-button-bg' : 'text-text-primary'}`}
                    title={value}
                  >
                    {value}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

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
  const AgentMetricStatistics = useSlot('AgentMetricStatistics');
  const AgentMetricsTimeRangeFilter = useSlot('AgentMetricsTimeRangeFilter');
  const featuredMeters =
    meters == null
      ? undefined
      : featuredMetricNames.flatMap(name => {
          const meter = meters.find(candidate => candidate.name === name);
          return meter == null ? [] : [meter];
        });
  const hasStatistics = meters?.some(meter => statisticMetricNames.has(meter.name)) ?? false;

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-secondary-bg/40 p-4" data-slot="agent-metrics-view">
      <div className="mb-4 flex justify-end">
        <AgentMetricsTimeRangeFilter timeRange={timeRange} onTimeRangeChange={onTimeRangeChange} />
      </div>

      {meterError != null ? (
        <div className="mb-4 rounded-lg border border-failure-bg/30 bg-failure-bg/10 p-3 text-sm text-failure-bg">
          {meterError}
        </div>
      ) : meters == null ? (
        <div className="mb-4 grid gap-4" aria-label="Loading metrics">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-20 rounded-lg" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }, (_, index) => (
              <Skeleton key={index} className="h-20 rounded-lg" />
            ))}
          </div>
        </div>
      ) : featuredMeters?.length === 0 && !hasStatistics ? (
        <div className="mb-4 rounded-lg border border-border bg-card-bg p-6 text-center text-sm text-text-secondary">
          No aggregate metrics
        </div>
      ) : (
        <div className="mb-4 grid gap-4">
          {featuredMeters != null && featuredMeters.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {featuredMeters.map(meter => (
                <AgentMetricCard key={meter.name} meter={meter} />
              ))}
            </div>
          ) : null}
          {hasStatistics ? <AgentMetricStatistics meters={meters} /> : null}
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
          {charts
            .flatMap<AgentMetricChartProps>(chart =>
              chart.graphs != null && chart.graphs.length > 0
                ? chart.graphs.map(graph => ({ definition: chart.definition, graph, error: chart.error }))
                : [{ definition: chart.definition, error: chart.error }],
            )
            .map(({ definition, graph, error }, colorIndex) => (
              <AgentMetricChart
                key={graph == null ? definition.name : `${definition.name}:${graph.name}`}
                definition={definition}
                error={error}
                colorIndex={colorIndex}
                {...(graph == null ? {} : { graph })}
              />
            ))}
        </div>
      )}
    </div>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentMetricStatistics: ComponentType<AgentMetricStatisticsProps>;
    AgentMetricsView: ComponentType<AgentMetricsViewProps>;
  }
}
