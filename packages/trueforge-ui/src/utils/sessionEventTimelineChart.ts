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
  /** Active track span plus pause wall waits (compressed chart span omits pauses). */
  durationMs?: number;
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
 * Same thread only — concurrent sub-agent approvals share a compressed x but must
 * stay on their own lanes (not one stack of N diamonds on the first track).
 * Example: approval_required + policy at the same ms on main → one diamond.
 */
export function groupCoincidentTimelineMarkers(
  segments: SessionEventTimelineSegment[],
  { toleranceMs = 0 }: { toleranceMs?: number } = {},
): TimelineMarkerGroup[] {
  const markers = segments
    .flatMap((segment, index) => (segment.isMarker ? [{ segment, index }] : []))
    .sort(
      (left, right) =>
        left.segment.threadId.localeCompare(right.segment.threadId) ||
        left.segment.startMs - right.segment.startMs ||
        left.index - right.index,
    )
    .map(({ segment }) => segment);

  const groups: TimelineMarkerGroup[] = [];
  for (const segment of markers) {
    const current = groups.at(-1);
    const sameThread = current != null && current.segments[0]?.threadId === segment.threadId;
    if (sameThread && segment.startMs - current.startMs <= toleranceMs) {
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
  /** When set, only markers on this thread pack onto the chip. */
  threadId?: string;
  /** Segment id, so approval markers can pin to a specific wait span. */
  id?: string;
};

/**
 * How far before a chip start a marker may still belong to that pause.
 * Matches gateway lead-in (approval a few ms before turn.update paused) — not full chip width.
 */
export const PAUSE_MARKER_LEAD_MS = 50;

/** Map wall offset into the chip: offset=0 → left edge, offset=wall → right edge. */
function pauseMarkerX({ chip, offsetMs }: { chip: TimelinePauseChipRange; offsetMs: number }): number {
  const span = Math.max(0, chip.endMs - chip.startMs);
  const wall = Math.max(0, chip.wallDurationMs);
  if (span <= 0 || wall <= 0) return chip.startMs;
  const ratio = Math.min(1, Math.max(0, offsetMs / wall));
  return chip.startMs + ratio * span;
}

/**
 * Find which pause chip owns a marker group.
 * On-chip, or within PAUSE_MARKER_LEAD_MS before the chip (gateway lead-in /
 * pauseOffsetMs anchors) — never the full expanded chip width.
 */
function markerGroupThreadId(group: TimelineMarkerGroup): string | undefined {
  const threadIds = new Set(group.segments.map(segment => segment.threadId));
  if (threadIds.size !== 1) return undefined;
  return [...threadIds][0];
}

function pauseChipMatchesThread(chip: TimelinePauseChipRange, threadId: string | undefined): boolean {
  // Unscoped chips (tests / legacy) accept any marker.
  if (chip.threadId == null) return true;
  // Scoped chips only accept that thread — never a mixed/unknown group.
  if (threadId == null) return false;
  return chip.threadId === threadId;
}

function pauseChipForMarkerGroup({
  group,
  pauseChips,
}: {
  group: TimelineMarkerGroup;
  pauseChips: readonly TimelinePauseChipRange[];
}): TimelinePauseChipRange | undefined {
  const threadId = markerGroupThreadId(group);
  const onChip = pauseChips.find(
    candidate =>
      pauseChipMatchesThread(candidate, threadId) &&
      group.startMs >= candidate.startMs &&
      group.startMs <= candidate.endMs,
  );
  if (onChip != null) return onChip;

  // Gateway lead-in / compressed anchors sit a few ms before the chip — not a full chip width away.
  let best: TimelinePauseChipRange | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const candidate of pauseChips) {
    if (!pauseChipMatchesThread(candidate, threadId)) continue;
    if (group.startMs > candidate.startMs) continue;
    const delta = candidate.startMs - group.startMs;
    if (delta > PAUSE_MARKER_LEAD_MS || delta >= bestDelta) continue;
    best = candidate;
    bestDelta = delta;
  }
  return best;
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
    // Approval diamonds pinned to a wait span use that span's edges, not the
    // turn-pause offset (which lands mid-hatch on a long span).
    const pinned = group.segments.filter(segment => segment.pauseSpanId != null);
    const floating = group.segments.filter(segment => segment.pauseSpanId == null);
    for (const segment of pinned) {
      const span = pauseChips.find(candidate => candidate.id === segment.pauseSpanId);
      const x = span == null ? group.startMs : segment.pauseSpanEdge === 'end' ? span.endMs : span.startMs;
      packed.push({
        id: `${group.id}-${segment.id}`,
        x,
        segments: [segment],
      });
    }
    if (floating.length === 0) continue;

    const floatingGroup = { ...group, segments: floating };
    const chip = pauseChipForMarkerGroup({ group: floatingGroup, pauseChips });
    if (chip == null) {
      packed.push({ id: group.id, x: group.startMs, segments: floating });
      continue;
    }

    const ordered = [...floating].sort(
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
 * Split activity that crosses a chip point so the hatch owns that x-range alone.
 * Pre stays before the chip; post starts at the chip point (shifted past by layout).
 */
function splitActivityAtChipStarts(
  segment: SessionEventTimelineSegment,
  chipStartsMs: readonly number[],
): SessionEventTimelineSegment[] {
  // Lifetime / pause geometry stays whole — only model/tool bars are exclusive of hatch.
  if (segment.isPauseChip || segment.isPauseSpan || segment.isMarker || segment.type === 'sub_agent') {
    return [segment];
  }
  let parts = [segment];
  for (const chipStartMs of chipStartsMs) {
    parts = parts.flatMap(part => {
      if (!(part.startMs < chipStartMs && part.endMs > chipStartMs)) return [part];
      return [
        { ...part, endMs: chipStartMs, id: `${part.id}@pre:${chipStartMs}` },
        { ...part, startMs: chipStartMs, id: `${part.id}@post:${chipStartMs}` },
      ];
    });
  }
  return parts;
}

/**
 * After compression, pause chips are 0-width. Give each a fixed chart width
 * (pauseChipMs ≈ 32px in time units) and push later work past them.
 *
 * Activity that would span a chip is split first so the hatch slot stays exclusive
 * (no model/tool bar drawn through the paused region).
 * Markers on the chip anchor stay put for packing.
 */
export function applyPauseChipLayout({
  segments,
  pauseChipMs,
}: {
  segments: SessionEventTimelineSegment[];
  pauseChipMs: number;
}): SessionEventTimelineSegment[] {
  // Unique starts — concurrent sub-agent pauses share one chart gap, not N× width.
  const chips = [...new Set(segments.filter(segment => segment.isPauseChip).map(segment => segment.startMs))].sort(
    (left, right) => left - right,
  );
  if (chips.length === 0 || pauseChipMs <= 0) return segments;

  const pauseTurnByStartMs = new Map(
    segments.filter(segment => segment.isPauseChip).map(segment => [segment.startMs, segment.turnIndex] as const),
  );

  const splitSegments = segments.flatMap(segment => splitActivityAtChipStarts(segment, chips));

  return splitSegments.map(segment => {
    let startShift = 0;
    let endShift = 0;
    for (const chipStartMs of chips) {
      if (segment.isPauseChip && segment.startMs === chipStartMs) continue;
      // Keep pause-anchored diamonds on the chip; next-turn markers that share the
      // compressed timestamp (cancelled-for-next-turn) must move past the hatch.
      if (segment.isMarker && segment.startMs === chipStartMs) {
        const pauseTurnIndex = pauseTurnByStartMs.get(chipStartMs);
        const staysOnChip =
          segment.pauseOffsetMs != null || (pauseTurnIndex != null && segment.turnIndex === pauseTurnIndex);
        if (staysOnChip) continue;
        startShift += pauseChipMs;
        endShift += pauseChipMs;
        continue;
      }

      // Wait span that touches this chip paints across the slot. A hidden
      // compression chip must not leave a blank the span then starts after.
      if (segment.isPauseSpan && segment.startMs <= chipStartMs && segment.endMs >= chipStartMs) {
        endShift += pauseChipMs;
        continue;
      }

      const startsAtOrAfterChip = segment.isMarker ? segment.startMs > chipStartMs : segment.startMs >= chipStartMs;
      if (startsAtOrAfterChip) {
        startShift += pauseChipMs;
        endShift += pauseChipMs;
      } else if (segment.endMs > chipStartMs) {
        // Anything still overlapping — only the tail moves past.
        endShift += pauseChipMs;
      }
    }
    const startMs = segment.startMs + startShift;
    if (segment.isPauseChip) {
      return { ...segment, startMs, endMs: startMs + pauseChipMs };
    }
    return { ...segment, startMs, endMs: segment.endMs + endShift };
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
  const gaps = visualGaps ?? (turnStartsMs ?? []).slice(1).map(atActiveMs => ({ atActiveMs, gapMs: turnGapMs ?? 0 }));
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
 * Cumulative turn-separator shift per turnIndex.
 * Skips a separator when a pause chip already sits on that boundary — common when
 * a turn stays paused for days then is cancelled-for-next-turn (pause end ≡ next start).
 */
export function getTurnGapShiftsMs({
  turnRanges,
  pauseChipStartsMs,
  turnGapMs,
}: {
  turnRanges: readonly TimelineTurnRange[];
  pauseChipStartsMs: readonly number[];
  turnGapMs: number;
}): Map<number, number> {
  const ordered = [...turnRanges].sort((left, right) => left.ordinal - right.ordinal);
  const shifts = new Map<number, number>();
  let cumulative = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const range = ordered[index];
    if (range == null) continue;
    shifts.set(range.turnIndex, cumulative);
    const next = ordered[index + 1];
    if (next == null || turnGapMs <= 0) continue;
    const pauseSeparates = pauseChipStartsMs.some(startMs => Math.abs(startMs - next.startMs) <= 1);
    if (!pauseSeparates) cumulative += turnGapMs;
  }
  return shifts;
}

/** Active-time anchors where a turn separator should be drawn (excludes pause-chip boundaries). */
export function getTurnGapAnchorMs({
  turnRanges,
  pauseChipStartsMs,
}: {
  turnRanges: readonly TimelineTurnRange[];
  pauseChipStartsMs: readonly number[];
}): number[] {
  const ordered = [...turnRanges].sort((left, right) => left.ordinal - right.ordinal);
  const anchors: number[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const startMs = ordered[index]?.startMs;
    if (startMs == null) continue;
    if (pauseChipStartsMs.some(pauseStartMs => Math.abs(pauseStartMs - startMs) <= 1)) continue;
    anchors.push(startMs);
  }
  return anchors;
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

/**
 * One main-row summary bar per turn: earliest sub start → latest sub end.
 * Gaps from pause chips / staggered finishes stay filled so the track reads continuous.
 */
export function mergeOverlappingSubAgentSegments(
  segments: SessionEventTimelineSegment[],
): SessionEventTimelineSegment[] {
  const byTurn = new Map<number, SessionEventTimelineSegment[]>();
  for (const segment of segments) {
    const list = byTurn.get(segment.turnIndex) ?? [];
    list.push(segment);
    byTurn.set(segment.turnIndex, list);
  }

  return [...byTurn.entries()]
    .sort((left, right) => left[0] - right[0])
    .flatMap(([turnIndex, list]) => {
      const first = list[0];
      if (first == null) return [];
      let startMs = first.startMs;
      let endMs = first.endMs;
      for (const segment of list) {
        startMs = Math.min(startMs, segment.startMs);
        endMs = Math.max(endMs, segment.endMs);
      }
      return [{ ...first, turnIndex, startMs, endMs }];
    });
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
    // Union bar covers the whole turn wave — list every sub in that turn.
    segments: subAgentSegments.filter(segment => segment.turnIndex === bar.turnIndex),
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
  // Per-sub-agent chips share one wall wait — merge overlapping intervals so we
  // don’t subtract the same pause N times.
  const rawPauses = segments
    .filter(segment => segment.isPauseChip)
    .map(segment => ({
      turnIndex: segment.turnIndex,
      startMs: segment.startMs,
      endMs: Math.max(segment.endMs, segment.startMs),
      wallDurationMs: segment.wallDurationMs ?? Math.max(0, segment.endMs - segment.startMs),
    }))
    .filter(pause => pause.wallDurationMs > 0)
    .sort(
      (left, right) => left.turnIndex - right.turnIndex || left.startMs - right.startMs || left.endMs - right.endMs,
    );
  const pauses: typeof rawPauses = [];
  for (const pause of rawPauses) {
    const previous = pauses.at(-1);
    if (previous != null && previous.turnIndex === pause.turnIndex && pause.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, pause.endMs);
      previous.wallDurationMs = previous.endMs - previous.startMs;
      continue;
    }
    pauses.push({ ...pause });
  }

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
