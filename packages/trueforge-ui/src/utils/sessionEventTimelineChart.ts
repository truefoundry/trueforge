import type { SessionEventTimelineSegment } from './sessionEventTimeline.js';


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
  | { type: typeof TIMELINE_TYPE.toolCallGroup; group: TimelineToolCallGroup; subAgentLabel?: string }
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
 * Merge diamonds that land on the same (or nearly same) x into one hover target.
 * Example: approval_required + policy at the same ms → one diamond, shared tooltip.
 */
export function groupCoincidentTimelineMarkers(
  segments: SessionEventTimelineSegment[],
  { toleranceMs = 0 }: { toleranceMs?: number } = {},
): TimelineMarkerGroup[] {
  const markers = segments
    .flatMap((segment, index) => (segment.isMarker ? [{ segment, index }] : []))
    .sort((left, right) => left.segment.startMs - right.segment.startMs || left.index - right.index)
    .map(({ segment }) => segment);

  const groups: TimelineMarkerGroup[] = [];
  for (const segment of markers) {
    const current = groups.at(-1);
    if (current != null && segment.startMs - current.startMs <= toleranceMs) {
      current.segments.push(segment);
      continue;
    }
    groups.push({
      id: segment.id,
      startMs: segment.startMs,
      endMs: segment.startMs,
      segments: [segment],
    });
  }

  return groups.map(group => ({
    ...group,
    id: `marker-group-${group.segments.map(segment => segment.id).join('-')}`,
  }));
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

/**
 * Extra empty space inserted on the chart axis (not real work time).
 * Turn separators: small gap between turns. Pause chips: fixed-width hatched bar.
 */
export type TimelineVisualGap = {
  /** Where on the compressed “active work” axis this gap starts. */
  atActiveMs: number;
  gapMs: number;
  /**
   * Pause chips: the diamond at `atActiveMs` sits *inside* the gap.
   * Turn separators: that point sits *after* the gap.
   */
  containsAnchor?: boolean;
  /** Real paused wait (for wall-time axis labels); turn separators omit this. */
  wallDurationMs?: number;
};

/** How far to shift an active-time point after earlier visual gaps. */
export function visualGapShiftMs(activeMs: number, gaps: readonly TimelineVisualGap[]): number {
  return gaps.reduce((shift, gap) => {
    const applies = gap.containsAnchor ? activeMs > gap.atActiveMs : activeMs >= gap.atActiveMs;
    return applies ? shift + gap.gapMs : shift;
  }, 0);
}

/** Convert active-time visual gaps into [start,end] ranges in chart coordinates. */
export function buildTimelineGaps(gaps: readonly TimelineVisualGap[]): TimelineGap[] {
  const ordered = [...gaps].sort((left, right) => left.atActiveMs - right.atActiveMs);
  return ordered.map(gap => {
    const priorShift = ordered
      .filter(candidate => candidate.atActiveMs < gap.atActiveMs)
      .reduce((sum, candidate) => sum + candidate.gapMs, 0);
    const startMs = gap.atActiveMs + priorShift;
    return { startMs, endMs: startMs + gap.gapMs };
  });
}

export type PackedTimelineMarker = {
  id: string;
  x: number;
  segments: SessionEventTimelineSegment[];
};

/** Expanded pause chip on the chart + how long the real wait was. */
export type TimelinePauseChipRange = TimelineGap & {
  wallDurationMs: number;
};

/** Map wall offset into the chip: offset=0 → left edge, offset=wall → right edge. */
function pauseMarkerX({
  chip,
  offsetMs,
}: {
  chip: TimelinePauseChipRange;
  offsetMs: number;
}): number {
  const span = Math.max(0, chip.endMs - chip.startMs);
  const wall = Math.max(0, chip.wallDurationMs);
  if (span <= 0 || wall <= 0) return chip.startMs;
  const ratio = Math.min(1, Math.max(0, offsetMs / wall));
  return chip.startMs + ratio * span;
}

/**
 * Find which pause chip owns a marker group.
 * Needed because approval events can land a few ms before `turn.update` paused,
 * or share a chip via pauseOffsetMs after compression.
 */
function pauseChipForMarkerGroup({
  group,
  pauseChips,
}: {
  group: TimelineMarkerGroup;
  pauseChips: readonly TimelinePauseChipRange[];
}): TimelinePauseChipRange | undefined {
  const onChip = pauseChips.find(
    candidate => group.startMs >= candidate.startMs && group.startMs <= candidate.endMs,
  );
  if (onChip != null) return onChip;
  // Slightly before chip start (gateway lead-in / grouping tolerance).
  let best: TimelinePauseChipRange | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const candidate of pauseChips) {
    if (group.startMs > candidate.startMs) continue;
    const delta = candidate.startMs - group.startMs;
    if (delta <= candidate.endMs - candidate.startMs && delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }
  if (best != null) return best;
  // After compression many pause markers share the chip start; use pauseOffsetMs.
  if (group.segments.some(segment => segment.pauseOffsetMs != null)) {
    return pauseChips.find(candidate => Math.abs(group.startMs - candidate.startMs) <= candidate.endMs - candidate.startMs);
  }
  return undefined;
}

/**
 * Spread pause-related diamonds across the hatched chip by when they happened.
 *
 * Example: pause lasts 120s; approval at +0s and user approve at +120s →
 * two diamonds (left and right of the chip). Same offset → one diamond.
 * Markers not on a pause chip stay as a single point.
 */
export function packTimelineMarkers({
  groups,
  pauseChips,
}: {
  groups: TimelineMarkerGroup[];
  pauseChips: readonly TimelinePauseChipRange[];
}): PackedTimelineMarker[] {
  const packed: PackedTimelineMarker[] = [];
  for (const group of groups) {
    const chip = pauseChipForMarkerGroup({ group, pauseChips });
    if (chip == null) {
      packed.push({ id: group.id, x: group.startMs, segments: group.segments });
      continue;
    }

    const ordered = [...group.segments].sort(
      (left, right) => (left.pauseOffsetMs ?? 0) - (right.pauseOffsetMs ?? 0) || left.id.localeCompare(right.id),
    );
    const byOffset = new Map<number, SessionEventTimelineSegment[]>();
    for (const segment of ordered) {
      const offset = segment.pauseOffsetMs ?? 0;
      const bucket = byOffset.get(offset) ?? [];
      bucket.push(segment);
      byOffset.set(offset, bucket);
    }
    for (const [offset, segments] of byOffset) {
      packed.push({
        id: `${group.id}-${segments.map(segment => segment.id).join('-')}`,
        x: pauseMarkerX({ chip, offsetMs: offset }),
        segments,
      });
    }
  }
  return packed;
}

/**
 * After compression, pause chips are 0-width. Give each a fixed chart width
 * (pauseChipMs ≈ 32px in time units) and push later bars to the right.
 * Markers tied to the chip start stay put so packing can place them on the bar.
 */
export function applyPauseChipLayout({
  segments,
  pauseChipMs,
}: {
  segments: SessionEventTimelineSegment[];
  pauseChipMs: number;
}): SessionEventTimelineSegment[] {
  const chips = segments
    .filter(segment => segment.isPauseChip)
    .map(segment => segment.startMs)
    .sort((left, right) => left - right);
  if (chips.length === 0 || pauseChipMs <= 0) return segments;

  return segments.map(segment => {
    let shift = 0;
    for (const chipStartMs of chips) {
      if (segment.isPauseChip && segment.startMs === chipStartMs) continue;
      if (segment.isMarker && segment.startMs === chipStartMs) continue;
      if (segment.startMs > chipStartMs || (!segment.isMarker && segment.startMs >= chipStartMs)) {
        shift += pauseChipMs;
      }
    }
    const startMs = segment.startMs + shift;
    if (segment.isPauseChip) {
      return { ...segment, startMs, endMs: startMs + pauseChipMs };
    }
    return { ...segment, startMs, endMs: segment.endMs + shift };
  });
}

/** Generate clean active-time ticks, translated around fixed visual separators. */
export function buildTimelineAxisTicks({
  activeTotalMs,
  turnStartsMs,
  turnGapMs,
  visualGaps,
}: {
  activeTotalMs: number;
  turnStartsMs?: number[];
  turnGapMs?: number;
  visualGaps?: readonly TimelineVisualGap[];
}): Array<{ value: number }> {
  const gaps =
    visualGaps ??
    (turnStartsMs ?? []).slice(1).map(atActiveMs => ({ atActiveMs, gapMs: turnGapMs ?? 0 }));
  const stepMs = getCleanAxisStepMs(activeTotalMs);
  const activeTicks: number[] = [];
  for (let activeMs = 0; activeMs < activeTotalMs; activeMs += stepMs) activeTicks.push(activeMs);
  const lastRegularTick = activeTicks.at(-1);
  if (lastRegularTick != null && lastRegularTick > 0 && activeTotalMs - lastRegularTick < stepMs / 4) {
    activeTicks.pop();
  }
  if (activeTicks.at(-1) !== activeTotalMs) activeTicks.push(activeTotalMs);
  return activeTicks.map(activeMs => ({
    value: activeMs + visualGapShiftMs(activeMs, gaps),
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
 * Shrink long human pauses inside a turn so active work stays readable.
 *
 * Without this, a 10-minute wait would squash a 2-second model bar to a sliver.
 * We collapse each pause to a point (keep wallDurationMs), pull later same-turn
 * work left, then the chart re-expands the chip to ~32px.
 *
 * Example: [model 0–2s][pause 2–182s][tool 182–185s]
 *       → [model 0–2s][pause@2s][tool 2–5s]
 */
export function compressIntraTurnPauses(segments: SessionEventTimelineSegment[]): SessionEventTimelineSegment[] {
  const pauses = segments
    .filter(segment => segment.isPauseChip)
    .map(segment => ({
      turnIndex: segment.turnIndex,
      startMs: segment.startMs,
      endMs: Math.max(segment.endMs, segment.startMs),
      wallDurationMs: segment.wallDurationMs ?? Math.max(0, segment.endMs - segment.startMs),
    }))
    .filter(pause => pause.wallDurationMs > 0)
    .sort(
      (left, right) =>
        left.turnIndex - right.turnIndex || left.startMs - right.startMs || left.endMs - right.endMs,
    );

  if (pauses.length === 0) return segments;

  return segments.map(segment => {
    const relevant = pauses.filter(pause => pause.turnIndex === segment.turnIndex);
    if (relevant.length === 0) return segment;

    let startShift = 0;
    let endShift = 0;
    for (const pause of relevant) {
      if (segment.startMs >= pause.endMs) startShift += pause.wallDurationMs;
      else if (segment.startMs > pause.startMs) startShift += segment.startMs - pause.startMs;
      if (segment.endMs >= pause.endMs) endShift += pause.wallDurationMs;
      else if (segment.endMs > pause.startMs) endShift += segment.endMs - pause.startMs;
    }

    const startMs = Math.max(0, segment.startMs - startShift);
    if (segment.isPauseChip) {
      return {
        ...segment,
        startMs,
        endMs: startMs,
        wallDurationMs: segment.wallDurationMs ?? Math.max(0, segment.endMs - segment.startMs),
      };
    }
    return {
      ...segment,
      startMs,
      endMs: Math.max(startMs, segment.endMs - endShift),
    };
  });
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

/**
 * Chart x → real elapsed wall time (for axis labels like “3m 40s”).
 *
 * Active work maps 1:1. Hovering mid-chip interpolates that pause’s wall wait
 * (left edge = start of pause, right edge = full wait). Turn gaps add 0 wall time.
 *
 * Example: 2s work + 32px chip for a 3m pause + 1s work → right edge of chip ≈ 3m 2s.
 */
export function getWallTimelineMs({
  valueMs,
  visualGaps,
}: {
  valueMs: number;
  visualGaps: readonly TimelineVisualGap[];
}): number {
  const ordered = [...visualGaps].sort((left, right) => left.atActiveMs - right.atActiveMs);
  const chartGaps = buildTimelineGaps(ordered);
  const activeMs = getActiveTimelineMs(valueMs, chartGaps);
  let wallMs = activeMs;
  for (let index = 0; index < ordered.length; index += 1) {
    const gap = ordered[index];
    const chart = chartGaps[index];
    const wallDurationMs = gap?.wallDurationMs ?? 0;
    if (gap == null || chart == null || wallDurationMs <= 0) continue;
    if (valueMs >= chart.endMs) {
      wallMs += wallDurationMs;
      continue;
    }
    if (valueMs > chart.startMs) {
      const span = chart.endMs - chart.startMs;
      const ratio = span > 0 ? (valueMs - chart.startMs) / span : 0;
      wallMs += ratio * wallDurationMs;
    }
  }
  return Math.max(0, wallMs);
}
