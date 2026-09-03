import { getSessionEventColor, type SessionEventTimelineSegment } from './sessionEventTimeline.js';
import { isRecord } from './sessionTimelineEvents.js';
import type { SessionTurnView } from './sessionTurnViews.js';

export type SessionMetricBarDatum = {
  label: string;
  value: number;
  color: string;
};

export type SessionMetrics = {
  totalTurns: number;
  wallTimeMs: number;
  totalCostUsd?: number;
  totalTokens: number;
  contextTokens: number;
  toolCalls: number;
  subAgents: number;
  errors: number;
  timeBreakdown: SessionMetricBarDatum[];
  costPerTurn: SessionMetricBarDatum[];
  tokenBreakdown: SessionMetricBarDatum[];
  contextByTurn: SessionMetricBarDatum[];
  toolCallFrequency: SessionMetricBarDatum[];
};

export type SessionListMetricsHint = {
  totalTurns: number;
  totalCostInUsd?: number;
  totalDurationMs: number;
};

function readNumber(record: Record<string, unknown>, camel: string, snake: string): number {
  const camelValue = record[camel];
  if (typeof camelValue === 'number' && Number.isFinite(camelValue)) return camelValue;
  const snakeValue = record[snake];
  return typeof snakeValue === 'number' && Number.isFinite(snakeValue) ? snakeValue : 0;
}

function readOptionalNumber({
  record,
  camel,
  snake,
}: {
  record: Record<string, unknown>;
  camel: string;
  snake: string;
}): number | undefined {
  const camelValue = record[camel];
  if (typeof camelValue === 'number' && Number.isFinite(camelValue)) return camelValue;
  const snakeValue = record[snake];
  return typeof snakeValue === 'number' && Number.isFinite(snakeValue) ? snakeValue : undefined;
}

function metricsRecord(state: unknown): Record<string, unknown> | undefined {
  if (!isRecord(state)) return undefined;
  return isRecord(state.metrics) ? state.metrics : undefined;
}

function segmentDurationMs(segment: SessionEventTimelineSegment): number {
  return Math.max(0, segment.endMs - segment.startMs);
}

function hintHasValues(hint?: SessionListMetricsHint): boolean {
  return hint != null && (hint.totalTurns > 0 || hint.totalCostInUsd != null || hint.totalDurationMs > 0);
}

export function buildSessionMetrics({
  turns,
  segments,
  listMetrics,
}: {
  turns: SessionTurnView[];
  segments: SessionEventTimelineSegment[];
  listMetrics?: SessionListMetricsHint;
}): SessionMetrics {
  let derivedWallTimeMs = 0;
  let derivedCostUsd = 0;
  let hasDerivedCost = false;
  let totalTokens = 0;
  let totalUncachedInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  let contextTokens = 0;
  const costPerTurn: SessionMetricBarDatum[] = [];
  const contextByTurn: SessionMetricBarDatum[] = [];

  for (const turn of turns) {
    const label = `T${turn.turnNumber}`;
    derivedWallTimeMs += turn.durationMs ?? 0;
    const metrics = metricsRecord(turn.done?.state);
    if (metrics == null) {
      costPerTurn.push({ label, value: 0, color: getSessionEventColor('tool_call') });
      contextByTurn.push({ label, value: contextTokens, color: getSessionEventColor('model') });
      continue;
    }

    const inputTokens = readNumber(metrics, 'totalInputTokens', 'total_input_tokens');
    const outputTokens = readNumber(metrics, 'totalOutputTokens', 'total_output_tokens');
    const cachedTokens =
      readNumber(metrics, 'totalCacheReadTokens', 'total_cache_read_tokens') +
      readNumber(metrics, 'totalCacheWriteTokens', 'total_cache_write_tokens');
    const uncachedInputTokens = Math.max(0, inputTokens - cachedTokens);
    const turnTotalTokens = readNumber(metrics, 'totalTokens', 'total_tokens') || inputTokens + outputTokens;
    const turnCostUsd = readOptionalNumber({
      record: metrics,
      camel: 'totalCostInUsd',
      snake: 'total_cost_in_usd',
    });

    if (turnCostUsd != null) {
      derivedCostUsd += turnCostUsd;
      hasDerivedCost = true;
    }
    totalTokens += turnTotalTokens;
    totalUncachedInputTokens += uncachedInputTokens;
    totalOutputTokens += outputTokens;
    totalCachedTokens += cachedTokens;
    contextTokens += turnTotalTokens;
    costPerTurn.push({ label, value: turnCostUsd ?? 0, color: getSessionEventColor('tool_call') });
    contextByTurn.push({ label, value: contextTokens, color: getSessionEventColor('model') });
  }

  const modelTimeMs = segments
    .filter(segment => segment.type === 'model')
    .reduce((sum, segment) => sum + segmentDurationMs(segment), 0);
  const toolTimeMs = segments
    .filter(segment => segment.type === 'tool_call')
    .reduce((sum, segment) => sum + segmentDurationMs(segment), 0);
  const waitingTimeMs = segments
    .filter(segment => segment.type === 'waiting_on_human' || segment.type === 'approval')
    .reduce((sum, segment) => sum + segmentDurationMs(segment), 0);
  const wallTimeMs = hintHasValues(listMetrics)
    ? (listMetrics?.totalDurationMs ?? derivedWallTimeMs)
    : derivedWallTimeMs;
  const overheadTimeMs = Math.max(0, wallTimeMs - modelTimeMs - toolTimeMs - waitingTimeMs);

  const toolCallCounts = new Map<string, number>();
  for (const segment of segments) {
    if (segment.type !== 'tool_call') continue;
    toolCallCounts.set(segment.description, (toolCallCounts.get(segment.description) ?? 0) + 1);
  }
  const toolCallFrequency = Array.from(toolCallCounts, ([label, value]) => ({
    label,
    value,
    color: getSessionEventColor('tool_call'),
  })).sort((left, right) => right.value - left.value);

  const totalCostUsd = listMetrics?.totalCostInUsd ?? (hasDerivedCost ? derivedCostUsd : undefined);

  return {
    totalTurns: hintHasValues(listMetrics) ? (listMetrics?.totalTurns ?? turns.length) : turns.length,
    wallTimeMs,
    ...(totalCostUsd == null ? {} : { totalCostUsd }),
    totalTokens,
    contextTokens,
    toolCalls: toolCallFrequency.reduce((sum, toolCall) => sum + toolCall.value, 0),
    subAgents: segments.filter(segment => segment.type === 'sub_agent').length,
    errors: segments.filter(segment => segment.type === 'error').length,
    timeBreakdown: [
      { label: 'model', value: modelTimeMs, color: getSessionEventColor('model') },
      { label: 'tools', value: toolTimeMs, color: getSessionEventColor('tool_call') },
      { label: 'waiting on human', value: waitingTimeMs, color: getSessionEventColor('approval') },
      { label: 'overhead', value: overheadTimeMs, color: getSessionEventColor('system') },
    ],
    costPerTurn,
    tokenBreakdown: [
      { label: 'input', value: totalUncachedInputTokens, color: getSessionEventColor('model') },
      { label: 'output', value: totalOutputTokens, color: getSessionEventColor('user') },
      { label: 'cached', value: totalCachedTokens, color: getSessionEventColor('sub_agent') },
    ],
    contextByTurn,
    toolCallFrequency,
  };
}
