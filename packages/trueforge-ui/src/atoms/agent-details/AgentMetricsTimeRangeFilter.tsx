import type { ComponentType } from 'react';

import { useSlot } from '../../theme/SlotsProvider.js';
import type { AgentMetricsTimeRangeFilterProps } from './types.js';

export function AgentMetricsTimeRangeFilter({ timeRange, onTimeRangeChange }: AgentMetricsTimeRangeFilterProps) {
  const AgentSessionsFilters = useSlot('AgentSessionsFilters');

  return (
    <AgentSessionsFilters
      agentId={null}
      timeRange={timeRange}
      onAgentChange={() => undefined}
      onTimeRangeChange={onTimeRangeChange}
      showAgentFilter={false}
      showCustomTimeRange={false}
    />
  );
}

declare module '../../theme/SlotsProvider.js' {
  interface AtomSlots {
    AgentMetricsTimeRangeFilter: ComponentType<AgentMetricsTimeRangeFilterProps>;
  }
}
