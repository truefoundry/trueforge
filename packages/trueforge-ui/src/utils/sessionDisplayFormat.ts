/** Compact token count for session/turn headers (e.g. 122K). */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(0)}K`;
  }
  return String(tokens);
}

/** USD cost with four decimal places (e.g. $0.1615). */
export function formatCostUsd(costInUsd: number): string {
  return `$${costInUsd.toFixed(4)}`;
}

/** Duration from milliseconds (e.g. 41.38s, 1.92m). */
export function formatDurationMs(durationMs: number): string {
  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(2)}s`;
  }
  if (durationMs < 3_600_000) {
    return `${(durationMs / 60_000).toFixed(2)}m`;
  }
  return `${(durationMs / 3_600_000).toFixed(2)}h`;
}

export function formatSessionListMetrics(metrics: {
  totalTurns: number;
  totalCostInUsd?: number;
  totalDurationMs: number;
}): string {
  return [
    `${metrics.totalTurns} turns`,
    ...(metrics.totalCostInUsd == null ? [] : [formatCostUsd(metrics.totalCostInUsd)]),
    formatDurationMs(metrics.totalDurationMs),
  ].join(' | ');
}
