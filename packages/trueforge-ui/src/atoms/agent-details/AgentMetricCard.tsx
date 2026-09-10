import type { ComponentType } from 'react';

import { formatCostUsd, formatDurationMs } from '../../utils/sessionDisplayFormat.js';
import type { AgentMetricCardProps } from './types.js';

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });

function formatMeterValue(value: number, unit: string): string {
  if (unit === '$') return formatCostUsd(value);
  if (unit === 'ms') return formatDurationMs(value);
  return `${numberFormatter.format(value)}${unit === 'count' || unit.length === 0 ? '' : ` ${unit}`}`;
}

export function AgentMetricCard({ meter }: AgentMetricCardProps) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-card-bg p-3" data-slot="agent-metric-card">
      <h3 className="truncate text-xs font-medium text-text-secondary" title={meter.description}>
        {meter.description}
      </h3>
      <p className="mt-2 text-xl font-semibold tabular-nums text-text-primary">
        {formatMeterValue(meter.aggregateValue, meter.unit)}
      </p>
    </section>
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentMetricCard: ComponentType<AgentMetricCardProps>;
  }
}
