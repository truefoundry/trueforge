import { MAIN_THREAD_ID, getSessionEventColor, type SessionEventTimelineSegment } from './sessionEventTimeline.js';
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

/** Optional getSession overrides for wall time and cost only — turn count always comes from events. */
export type SessionMetricsHint = {
  totalCostInUsd?: number;
  totalDurationMs: number;
};

function segmentDurationMs(segment: SessionEventTimelineSegment): number {
  return Math.max(0, segment.endMs - segment.startMs);
}

function turnHasMetrics(turn: SessionTurnView): boolean {
  return (
    turn.totalTokens != null ||
    turn.inputTokens != null ||
    turn.outputTokens != null ||
    turn.cachedTokens != null ||
    turn.totalCostInUsd != null
  );
}

export function buildSessionMetrics({
  turns,
  segments,
  sessionMetrics,
}: {
  turns: SessionTurnView[];
  segments: SessionEventTimelineSegment[];
  sessionMetrics?: SessionMetricsHint;
}): SessionMetrics {
  let derivedWallTimeMs = 0;
  let derivedCostUsd = 0;
  let hasDerivedCost = false;
  let totalTokens = 0;
  let totalUncachedInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCachedTokens = 0;
  // Aggregate by display band so MCP-auth resumes don't emit duplicate T1 chart keys.
  const bandCostUsd = new Map<number, number>();
  const bandTokens = new Map<number, number>();

  for (const turn of turns) {
    derivedWallTimeMs += turn.durationMs ?? 0;
    if (!turnHasMetrics(turn)) {
      if (!bandCostUsd.has(turn.turnNumber)) bandCostUsd.set(turn.turnNumber, 0);
      if (!bandTokens.has(turn.turnNumber)) bandTokens.set(turn.turnNumber, 0);
      continue;
    }

    // Prefer canonical turn fields from sessionTurnViews (uncached input already).
    const uncachedInputTokens = turn.inputTokens ?? 0;
    const outputTokens = turn.outputTokens ?? 0;
    const cachedTokens = turn.cachedTokens ?? 0;
    const turnTotalTokens = turn.totalTokens ?? uncachedInputTokens + cachedTokens + outputTokens;
    const turnCostUsd = turn.totalCostInUsd;

    if (turnCostUsd != null) {
      derivedCostUsd += turnCostUsd;
      hasDerivedCost = true;
    }
    totalTokens += turnTotalTokens;
    totalUncachedInputTokens += uncachedInputTokens;
    totalOutputTokens += outputTokens;
    totalCachedTokens += cachedTokens;
    bandCostUsd.set(turn.turnNumber, (bandCostUsd.get(turn.turnNumber) ?? 0) + (turnCostUsd ?? 0));
    bandTokens.set(turn.turnNumber, (bandTokens.get(turn.turnNumber) ?? 0) + turnTotalTokens);
  }

  const costPerTurn: SessionMetricBarDatum[] = [];
  const contextByTurn: SessionMetricBarDatum[] = [];
  let contextTokens = 0;
  for (const turnNumber of [...bandTokens.keys()].sort((left, right) => left - right)) {
    const label = `T${turnNumber}`;
    contextTokens += bandTokens.get(turnNumber) ?? 0;
    costPerTurn.push({
      label,
      value: bandCostUsd.get(turnNumber) ?? 0,
      color: getSessionEventColor('tool_call'),
    });
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
  // Detail session metrics may override wall time and cost; turn count is always from events.
  const wallTimeMs = sessionMetrics != null ? sessionMetrics.totalDurationMs : derivedWallTimeMs;
  const overheadTimeMs = Math.max(0, wallTimeMs - modelTimeMs - toolTimeMs - waitingTimeMs);

  const toolCallCounts = new Map<string, number>();
  for (const segment of segments) {
    if (segment.type !== 'tool_call' || segment.threadId !== MAIN_THREAD_ID) continue;
    toolCallCounts.set(segment.description, (toolCallCounts.get(segment.description) ?? 0) + 1);
  }
  const toolCallFrequency = Array.from(toolCallCounts, ([label, value]) => ({
    label,
    value,
    color: getSessionEventColor('tool_call'),
  })).sort((left, right) => right.value - left.value);

  const totalCostUsd =
    sessionMetrics != null ? sessionMetrics.totalCostInUsd : hasDerivedCost ? derivedCostUsd : undefined;

  return {
    totalTurns: turns.length,
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
