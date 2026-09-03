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

export const TIMELINE_TYPE = {
  turn: 'turn',
  event: 'event',
  toolCallGroup: 'toolCallGroup',
  subAgentGroup: 'subAgentGroup',
} as const;

export type TimelineHoverTarget =
  | { type: typeof TIMELINE_TYPE.turn; bar: TimelineTurnBar }
  | { type: typeof TIMELINE_TYPE.event; segment: SessionEventTimelineSegment }
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

/**
 * Select representative sub-agent tracks for the main event row.
 *
 * Longest-first selection preserves the tracks that explain the most elapsed
 * time; overlapping tracks are still available in dedicated sub-agent lanes.
 */
export function pickLongestNonOverlappingSegments(
  segments: SessionEventTimelineSegment[],
): SessionEventTimelineSegment[] {
  const selected: SessionEventTimelineSegment[] = [];
  for (const segment of [...segments].sort((left, right) => {
    const durationDiff = right.endMs - right.startMs - (left.endMs - left.startMs);
    return durationDiff !== 0 ? durationDiff : left.startMs - right.startMs;
  })) {
    if (selected.some(kept => segmentsOverlap(kept, segment))) continue;
    selected.push(segment);
  }
  return selected.sort((left, right) => left.startMs - right.startMs);
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

// Each visible main-row bar owns a tooltip containing only runs that overlap it.
// This avoids pulling in distant runs through a chain of transitive overlaps.
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

/**
 * Translate a chart-axis coordinate back to active elapsed time by subtracting
 * the fixed visual gaps inserted between turn bars.
 */
export function getActiveTimelineMs(valueMs: number, gaps: TimelineGap[]): number {
  let activeMs = valueMs;
  for (const gap of gaps) {
    activeMs -= Math.max(0, Math.min(valueMs, gap.endMs) - gap.startMs);
  }
  return Math.max(0, activeMs);
}

/**
 * Keep generated ticks before the active endpoint, then force endpoint and
 * padding ticks so the final duration label and trailing whitespace are stable.
 */
export function buildTimelineAxisTicks<T extends { value: number }>({
  ticks,
  totalMs,
  timelineMaxMs,
}: {
  ticks: readonly T[];
  totalMs: number;
  timelineMaxMs: number;
}): Array<T | { value: number }> {
  return [...ticks.filter(tick => tick.value < totalMs), { value: totalMs }, { value: timelineMaxMs }];
}
