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

export function roundDurationMsToSecond(durationMs: number): number {
  return Math.max(0, Math.round(durationMs / 1_000) * 1_000);
}

/** Whole-unit duration for prominent summary UI (e.g. 3m 8s). */
export function formatReadableDurationMs(durationMs: number): string {
  const totalSeconds = roundDurationMsToSecond(durationMs) / 1_000;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [
    ...(hours > 0 ? [`${hours}h`] : []),
    ...(minutes > 0 ? [`${minutes}m`] : []),
    ...(seconds > 0 || totalSeconds === 0 ? [`${seconds}s`] : []),
  ].join(' ');
}

export function formatSessionListMetrics(metrics: {
  totalTurns: number;
  totalCostInUsd?: number;
  totalDurationMs: number;
}): string {
  return [
    `${metrics.totalTurns} turns`,
    ...(metrics.totalCostInUsd == null ? [] : [formatCostUsd(metrics.totalCostInUsd)]),
    formatReadableDurationMs(metrics.totalDurationMs),
  ].join(' | ');
}
