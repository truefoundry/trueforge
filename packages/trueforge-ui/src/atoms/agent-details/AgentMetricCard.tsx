import type { ComponentType } from 'react';

import { Icon } from '../../icons/Icon.js';
import { formatCostUsd, formatDurationMs } from '../../utils/sessionDisplayFormat.js';
import { cn } from '../lib/cn.js';
import type { AgentMetricCardProps } from './types.js';

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });

function formatMeterValue(value: number, unit: string): string {
  if (unit === '$') return formatCostUsd(value);
  if (unit === 'ms') return formatDurationMs(value);
  return `${numberFormatter.format(value)}${unit === 'count' || unit.length === 0 ? '' : ` ${unit}`}`;
}

export function AgentMetricCard({ meter }: AgentMetricCardProps) {
  const isCost = meter.unit === '$';

  return (
    <section
      className={cn(
        'flex min-w-0 flex-col rounded-xl border border-l-4 border-border bg-card-bg p-3 shadow-sm',
        isCost ? 'border-l-success-bg' : 'border-l-primary-button-bg',
      )}
      data-slot="agent-metric-card"
    >
      <div className="flex w-full min-w-0 items-start justify-between gap-3">
        <h3 className="truncate text-sm font-medium text-text-secondary" title={meter.description}>
          {meter.description}
        </h3>
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold',
            isCost ? 'bg-success-bg/10 text-success-bg' : 'bg-primary-button-bg/10 text-primary-button-bg',
          )}
          aria-hidden
        >
          <Icon name={isCost ? 'dollar-sign' : 'message-square-text'} className="size-6" />
        </span>
      </div>
      <p className="text-4xl font-bold tabular-nums text-text-primary">
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
