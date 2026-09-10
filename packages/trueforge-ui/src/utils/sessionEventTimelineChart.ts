import type { SessionEventTimelineSegment } from './sessionEventTimeline.js';

/**
 * Pure layout helpers for the Sessions timeline.
 *
 * Segment construction owns event meaning; this module owns visual grouping,
 * lane allocation, and the compressed time axis. Keeping these calculations
 * outside React/Chart.js makes the rendering rules deterministic and testable.
 */

/** Minimal interval shared by bars, compressed gaps, and grouped tool calls. */
export type TimelineGap = {
  startMs: number;
  endMs: number;
};

export type TimelineTurnRange = {
  turnIndex: number;
  startMs: number;
  endMs: number;
  ordinal: number;
};

export type TimelineLayout = {
  turnStartsMs: number[];
  turnOrdinals: Map<number, number>;
  turnRanges: TimelineTurnRange[];
};

export type TimelineTurnBar = TimelineTurnRange & {
  id: string;
  durationMs: number;
};

export type TimelineSubAgentBar = SessionEventTimelineSegment & {
  lane: number;
  visualEndMs: number;
};

export type TimelineSubAgentLane = {
  threadId: string;
  lane: number;
  track: TimelineSubAgentBar;
  segments: SessionEventTimelineSegment[];
};

export type TimelineToolCallGroup = TimelineGap & {
  id: string;
  segments: SessionEventTimelineSegment[];
};

export type TimelineSubAgentGroup = TimelineGap & {
  id: string;
  barId: string;
  segments: SessionEventTimelineSegment[];
};

export type TimelineMarkerGroup = TimelineGap & {
  id: string;
  segments: SessionEventTimelineSegment[];
};

export const TIMELINE_TYPE = {
  turn: 'turn',
  event: 'event',
  markerGroup: 'markerGroup',
  toolCallGroup: 'toolCallGroup',
  subAgentGroup: 'subAgentGroup',
} as const;

export type TimelineHoverTarget =
  | { type: typeof TIMELINE_TYPE.turn; bar: TimelineTurnBar }
  | { type: typeof TIMELINE_TYPE.event; segment: SessionEventTimelineSegment }
  | { type: typeof TIMELINE_TYPE.markerGroup; group: TimelineMarkerGroup }
  | { type: typeof TIMELINE_TYPE.toolCallGroup; group: TimelineToolCallGroup }
  | { type: typeof TIMELINE_TYPE.subAgentGroup; group: TimelineSubAgentGroup };

/** Stable identity used to avoid replacing tooltip state while hovering the same bar. */
export function getTimelineHoverTargetId(target: TimelineHoverTarget | null): string {
  if (target == null) return '';
  if (target.type === TIMELINE_TYPE.turn) return target.bar.id;
  if (target.type === TIMELINE_TYPE.event) return target.segment.id;
  return target.group.id;
}

/** Convert an interval to Chart.js's floating horizontal-bar data shape. */
export function getTimelineRange({ startMs, endMs }: TimelineGap): [number, number] {
  return [startMs, endMs];
}

/** Collapse point events at an identical chart timestamp into one marker and tooltip. */
export function groupCoincidentTimelineMarkers(segments: SessionEventTimelineSegment[]): TimelineMarkerGroup[] {
  const groupsByTimestamp = new Map<number, SessionEventTimelineSegment[]>();
  for (const segment of segments) {
    if (!segment.isMarker) continue;
    const group = groupsByTimestamp.get(segment.startMs);
    if (group) group.push(segment);
    else groupsByTimestamp.set(segment.startMs, [segment]);
  }
  return Array.from(groupsByTimestamp, ([startMs, group]) => ({
    id: `marker-group-${group.map(segment => segment.id).join('-')}`,
    startMs,
    endMs: startMs,
    segments: group,
  })).sort((left, right) => left.startMs - right.startMs);
}

function timelineAxisUnit(totalMs: number): { divisorMs: number; suffix: string } {
  if (totalMs < 1_000) return { divisorMs: 1, suffix: 'ms' };
  if (totalMs < 60_000) return { divisorMs: 1_000, suffix: 's' };
  if (totalMs < 3_600_000) return { divisorMs: 60_000, suffix: 'm' };
  return { divisorMs: 3_600_000, suffix: 'h' };
}

/** Format an axis label as milliseconds, seconds, minutes, or hours by elapsed time. */
export function formatTimelineAxisDuration(durationMs: number): string {
  const unit = timelineAxisUnit(durationMs);
  return `${Number((durationMs / unit.divisorMs).toFixed(2))}${unit.suffix}`;
}

function getCleanAxisStepMs(totalMs: number): number {
  const { divisorMs } = timelineAxisUnit(totalMs);
  const target = totalMs / divisorMs / 8;
  if (divisorMs >= 60_000 && target < 1) return Math.max(0.25, Math.ceil(target * 4) / 4) * divisorMs;
  const integerTarget = Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(integerTarget));
  const normalized = integerTarget / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude * divisorMs;
}

/** Generate clean active-time ticks, translated around fixed visual turn separators. */
export function buildTimelineAxisTicks({
  activeTotalMs,
  turnStartsMs,
  turnGapMs,
}: {
  activeTotalMs: number;
  turnStartsMs: number[];
  turnGapMs: number;
}): Array<{ value: number }> {
  const stepMs = getCleanAxisStepMs(activeTotalMs);
  const activeTicks: number[] = [];
  for (let activeMs = 0; activeMs < activeTotalMs; activeMs += stepMs) activeTicks.push(activeMs);
  const lastRegularTick = activeTicks.at(-1);
  if (lastRegularTick != null && lastRegularTick > 0 && activeTotalMs - lastRegularTick < stepMs / 4) {
    activeTicks.pop();
  }
  if (activeTicks.at(-1) !== activeTotalMs) activeTicks.push(activeTotalMs);
  return activeTicks.map(activeMs => ({
    value: activeMs + turnStartsMs.slice(1).filter(turnStartMs => turnStartMs <= activeMs).length * turnGapMs,
  }));
}

/**
 * Derive one background range per turn from all of that turn's segments.
 *
 * Turn numbers can be sparse after filtering or incomplete server data, so
 * `ordinal` is a dense visual position while `turnIndex` remains the source id.
 */
export function getTimelineLayout(segments: SessionEventTimelineSegment[]): TimelineLayout {
  const rangesByTurnIndex = new Map<number, TimelineGap>();

  for (const segment of segments) {
    const range = rangesByTurnIndex.get(segment.turnIndex);
    if (range) {
      range.startMs = Math.min(range.startMs, segment.startMs);
      range.endMs = Math.max(range.endMs, segment.endMs);
    } else {
      rangesByTurnIndex.set(segment.turnIndex, { startMs: segment.startMs, endMs: segment.endMs });
    }
  }

  const ranges = Array.from(rangesByTurnIndex.entries()).sort(([left], [right]) => left - right);
  return {
    turnStartsMs: ranges.map(([, range]) => range.startMs),
    turnOrdinals: new Map(ranges.map(([turnIndex], ordinal) => [turnIndex, ordinal])),
    turnRanges: ranges.map(([turnIndex, range], ordinal) => ({
      turnIndex,
      startMs: range.startMs,
      endMs: range.endMs,
      ordinal,
    })),
  };
}

/** Touching endpoints do not overlap, allowing adjacent bars to share a row. */
function segmentsOverlap(left: SessionEventTimelineSegment, right: SessionEventTimelineSegment): boolean {
  return left.startMs < right.endMs && right.startMs < left.endMs;
}

/** Merge transitively overlapping sub-agent runs into summary bars for the main event row. */
export function mergeOverlappingSubAgentSegments(
  segments: SessionEventTimelineSegment[],
): SessionEventTimelineSegment[] {
  const merged: SessionEventTimelineSegment[] = [];
  for (const segment of [...segments].sort(
    (left, right) => left.turnIndex - right.turnIndex || left.startMs - right.startMs || left.endMs - right.endMs,
  )) {
    const current = merged.at(-1);
    if (current == null || current.turnIndex !== segment.turnIndex || !segmentsOverlap(current, segment)) {
      merged.push({ ...segment });
      continue;
    }
    current.endMs = Math.max(current.endMs, segment.endMs);
  }
  return merged;
}

/**
 * Merge transitively overlapping tool calls within the same turn and thread.
 *
 * Concurrent calls would otherwise draw on top of one another in the main
 * event row. The merged bar spans the union and its tooltip lists every member.
 * Calls from different turns/threads never merge even if timestamps overlap.
 */
export function groupOverlappingToolCalls(segments: SessionEventTimelineSegment[]): TimelineToolCallGroup[] {
  const groups: TimelineToolCallGroup[] = [];
  for (const segment of [...segments].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)) {
    const current = groups.at(-1);
    if (
      current == null ||
      current.segments[0]?.turnIndex !== segment.turnIndex ||
      current.segments[0]?.threadId !== segment.threadId ||
      segment.startMs >= current.endMs
    ) {
      groups.push({
        id: `tool-call-group-${segment.id}`,
        startMs: segment.startMs,
        endMs: segment.endMs,
        segments: [segment],
      });
      continue;
    }
    current.endMs = Math.max(current.endMs, segment.endMs);
    current.segments.push(segment);
  }
  return groups;
}

// Each merged main-row bar owns the runs represented by its full interval.
export function getSubAgentHoverGroups({
  bars,
  subAgentSegments,
}: {
  bars: SessionEventTimelineSegment[];
  subAgentSegments: SessionEventTimelineSegment[];
}): TimelineSubAgentGroup[] {
  return bars.map(bar => ({
    id: `sub-agent-group-${bar.id}`,
    barId: bar.id,
    startMs: bar.startMs,
    endMs: bar.endMs,
    segments: subAgentSegments.filter(
      segment => segment.turnIndex === bar.turnIndex && (segment.id === bar.id || segmentsOverlap(bar, segment)),
    ),
  }));
}

/**
 * Assign sub-agent tracks to the first reusable non-overlapping lane and attach
 * each thread's child events to that track.
 *
 * `minWidthMs` matches the chart's minimum pixel width in time units, preventing
 * visually widened markers from colliding even when their raw durations do not.
 */
export function getSubAgentLanes({
  subAgentSegments,
  threadSegments,
  minWidthMs,
}: {
  subAgentSegments: SessionEventTimelineSegment[];
  threadSegments: SessionEventTimelineSegment[];
  minWidthMs: number;
}): TimelineSubAgentLane[] {
  const laneEndsMs: number[] = [];
  const tracks = [...subAgentSegments]
    .sort((left, right) => left.startMs - right.startMs)
    .map(segment => {
      const visualEndMs = Math.max(segment.endMs, segment.startMs + minWidthMs);
      const freeLane = laneEndsMs.findIndex(laneEndMs => laneEndMs <= segment.startMs);
      const lane = freeLane === -1 ? laneEndsMs.length : freeLane;
      laneEndsMs[lane] = visualEndMs;
      return { ...segment, id: `${segment.id}-lane`, lane, visualEndMs };
    });

  const childrenByThreadId = new Map<string, SessionEventTimelineSegment[]>();
  for (const segment of threadSegments) {
    if (segment.type === 'sub_agent') continue;
    const children = childrenByThreadId.get(segment.threadId);
    if (children) children.push(segment);
    else childrenByThreadId.set(segment.threadId, [segment]);
  }

  return tracks.map(track => ({
    threadId: track.threadId,
    lane: track.lane,
    track,
    segments: childrenByThreadId.get(track.threadId) ?? [],
  }));
}

/**
 * Collapse real idle time between turns while preserving all within-turn
 * offsets and durations.
 *
 * Session history may contain minutes or days between user messages. Displaying
 * that idle time would squeeze useful execution bars into a few pixels, so each
 * turn is translated to begin where the previous one ended. The chart adds a
 * small fixed visual separator afterward.
 */
export function compressInterTurnGaps(segments: SessionEventTimelineSegment[]): SessionEventTimelineSegment[] {
  const rangesByTurnIndex = new Map<number, { turnIndex: number; startMs: number; endMs: number }>();
  for (const segment of segments) {
    const range = rangesByTurnIndex.get(segment.turnIndex);
    if (range) {
      range.startMs = Math.min(range.startMs, segment.startMs);
      range.endMs = Math.max(range.endMs, segment.endMs);
    } else {
      rangesByTurnIndex.set(segment.turnIndex, {
        turnIndex: segment.turnIndex,
        startMs: segment.startMs,
        endMs: segment.endMs,
      });
    }
  }

  const shiftsByTurnIndex = new Map<number, number>();
  let previousEndMs = 0;
  for (const [rangeIndex, range] of Array.from(rangesByTurnIndex.values())
    .sort((left, right) => left.turnIndex - right.turnIndex)
    .entries()) {
    const targetStartMs = rangeIndex === 0 ? 0 : previousEndMs;
    const shiftMs = targetStartMs - range.startMs;
    shiftsByTurnIndex.set(range.turnIndex, shiftMs);
    previousEndMs = range.endMs + shiftMs;
  }

  return segments.map(segment => {
    const shiftMs = shiftsByTurnIndex.get(segment.turnIndex) ?? 0;
    return { ...segment, startMs: segment.startMs + shiftMs, endMs: segment.endMs + shiftMs };
  });
}

/** Translate a chart coordinate back to active elapsed time across visual turn separators. */
export function getActiveTimelineMs(valueMs: number, gaps: TimelineGap[]): number {
  let activeMs = valueMs;
  for (const gap of gaps) {
    activeMs -= Math.max(0, Math.min(valueMs, gap.endMs) - gap.startMs);
  }
  return Math.max(0, activeMs);
}
