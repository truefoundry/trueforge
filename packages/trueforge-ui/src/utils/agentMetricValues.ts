import type { AgentMetricMeter } from '../server/types.js';

/**
 * Single-number surfaces (metric cards, statistics) show the agent-wide figure, and
 * fall back to the caller's own when the server withheld it for lack of access.
 */
export function visibleMeterValue(meter: AgentMetricMeter): number {
  return meter.aggregateValue ?? meter.createdByMeAggregateValue;
}
