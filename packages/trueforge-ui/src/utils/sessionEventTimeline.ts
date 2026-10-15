/**
 * Shared presentation model for the Sessions timeline.
 *
 * Raw server events are intentionally converted to this small, stable shape
 * before they reach Chart.js. That keeps transport compatibility and event
 * correlation out of the chart component and makes atoms easy to override.
 */

/** Events without a thread id belong to the root agent conversation. */
export const MAIN_THREAD_ID = 'main';

/** One wall-clock pause, after overlapping chips and spans are merged. */
type MergedPauseWindow = {
  startMs: number;
  endMs: number;
  segment: SessionEventTimelineSegment;
};

function pauseWallInterval(segment: SessionEventTimelineSegment): { startMs: number; endMs: number } | undefined {
  const startMs = segment.pauseWallStartMs;
  const endMs = segment.pauseWallEndMs;
  if (startMs != null && endMs != null && endMs > startMs) return { startMs, endMs };
  // Hand-built fixtures predate wall anchors. Chips that share a compressed start are one window.
  if (!segment.isPauseChip) return undefined;
  const wallMs = segment.wallDurationMs ?? 0;
  if (wallMs <= 0) return undefined;
  const anchor = segment.turnIndex * 1_000_000_000_000 + segment.startMs;
  return { startMs: anchor, endMs: anchor + wallMs };
}

function mergedPauseWindows(segments: readonly SessionEventTimelineSegment[]): MergedPauseWindow[] {
  const intervals: MergedPauseWindow[] = [];
  for (const segment of segments) {
    if (segment.isPauseChip !== true && segment.isPauseSpan !== true) continue;
    const interval = pauseWallInterval(segment);
    if (interval == null) continue;
    intervals.push({ ...interval, segment });
  }
  intervals.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const merged: MergedPauseWindow[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous != null && interval.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, interval.endMs);
      if (interval.segment.isPauseChip === true && previous.segment.isPauseChip !== true) {
        previous.segment = interval.segment;
      }
      continue;
    }
    merged.push({ ...interval });
  }
  return merged;
}

/** Wall-clock human wait. Overlapping chips and spans count once, including a span that outlasts its chip. */
export function mergedPauseWallMs(segments: readonly SessionEventTimelineSegment[]): number {
  return mergedPauseWindows(segments).reduce((sum, interval) => sum + (interval.endMs - interval.startMs), 0);
}

/**
 * One tooltip row per merged pause. A span that continues after the turn is
 * running extends that row instead of being dropped or added again.
 */
export function segmentsForTurnTooltip(
  segments: readonly SessionEventTimelineSegment[],
): SessionEventTimelineSegment[] {
  const rest = segments.filter(segment => segment.isPauseChip !== true && segment.isPauseSpan !== true);
  const pauses = mergedPauseWindows(segments).map((interval, index) => ({
    ...interval.segment,
    id: `${interval.segment.id}:merged:${index}`,
    isPauseChip: true,
    isPauseSpan: false,
    wallDurationMs: interval.endMs - interval.startMs,
  }));
  return [...rest, ...pauses];
}

export type SessionEventType =
  'system' | 'user' | 'model' | 'tool_call' | 'approval' | 'sub_agent' | 'waiting_on_human' | 'error';

export type SessionEventTypeDefinition = {
  id: SessionEventType;
  label: string;
  color: string;
  darkColor?: string;
};

/**
 * One drawable piece on the timeline (bar or diamond).
 *
 * Times are ms from session start (not absolute clock times).
 * - Same start/end → diamond marker (e.g. approval at t=8s).
 * - Different start/end → horizontal bar (e.g. model work 2s→5s).
 *
 * Pause chips are special: after compression they collapse to a point, but
 * `wallDurationMs` still remembers the real wait (e.g. 3m 40s) for labels.
 */
export type SessionEventTimelineSegment = {
  id: string;
  type: SessionEventType;
  title: string;
  description: string;
  startMs: number;
  endMs: number;
  turnIndex: number;
  threadId: string;
  isMarker?: boolean;
  /** Real paused wait in ms (kept even after the chip is compressed to a point). */
  wallDurationMs?: number;
  /**
   * Wall-clock pause interval from session start, before compression.
   * Chips and spans overlap; metrics and tooltips merge these instead of summing.
   */
  pauseWallStartMs?: number;
  pauseWallEndMs?: number;
  /** Hatched “Paused” chip; chart expands it to a fixed pixel width. */
  isPauseChip?: boolean;
  /**
   * Pause chip kept only so intra-turn compression still subtracts the wait.
   * Not drawn on any lane (e.g. sub-agent finished with no post-pause work).
   */
  isCompressionOnly?: boolean;
  /**
   * Hatched wait on a sub-agent lane while the turn is running (another thread
   * was resumed) but this thread is still pending approval. Keeps timeline width
   * (not collapsed to a 32px chip) so the lane stays paused until *this* agent resumes.
   */
  isPauseSpan?: boolean;
  /**
   * How far into the pause this marker happened (wall ms from pause start).
   * Example: approve at end of a 120s pause → pauseOffsetMs=120000 → diamond
   * is drawn at the right edge of the chip.
   */
  pauseOffsetMs?: number;
  /**
   * Sub-agent approval marker pinned to a wait span.
   * `start` = approval_required (left edge), `end` = user.tool_approval (right edge).
   */
  pauseSpanId?: string;
  pauseSpanEdge?: 'start' | 'end';
};

/** Canonical legend order, labels, and base colours for timeline event types. */
export const SESSION_EVENT_TYPES: SessionEventTypeDefinition[] = [
  { id: 'system', label: 'System', color: '#94a3b8' },
  { id: 'user', label: 'User', color: '#34d399' },
  { id: 'model', label: 'Model', color: '#3b82f6', darkColor: '#6366f1' },
  { id: 'tool_call', label: 'Tool call', color: '#f59e0b' },
  { id: 'approval', label: 'Approval / HITL', color: '#f472b6' },
  { id: 'sub_agent', label: 'Sub-agent', color: '#e2e8f0', darkColor: '#3f3f46' },
  { id: 'waiting_on_human', label: 'Waiting on human', color: '#22d3ee' },
  { id: 'error', label: 'Error', color: '#f87171' },
];

/** Marker-like events have no meaningful elapsed duration in their tooltip. */
export const SESSION_EVENT_TOOLTIP_HIDE_DURATION = new Set<SessionEventType>(['system', 'user', 'approval', 'error']);

const TOOLTIP_HEADINGS: Partial<Record<SessionEventType, string>> = {
  user: 'User Message',
  model: 'Model Response',
};

/** Format an axis/tooltip duration compactly while retaining roughly three significant digits. */
export function formatTimelineDuration(durationMs: number): string {
  if (durationMs <= 0) return '0ms';
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${Number((durationMs / 1_000).toPrecision(3))}s`;
  if (durationMs < 3_600_000) return `${Number((durationMs / 60_000).toPrecision(3))}m`;
  if (durationMs < 86_400_000) return `${Number((durationMs / 3_600_000).toPrecision(3))}h`;
  return `${Number((durationMs / 86_400_000).toPrecision(3))}d`;
}

/** Resolve a segment's color from the same registry used to build the legend. */
export function getSessionEventColor(type: SessionEventType, isDarkMode = false): string {
  const eventType = SESSION_EVENT_TYPES.find(eventType => eventType.id === type);
  return (isDarkMode ? eventType?.darkColor : undefined) ?? eventType?.color ?? '#94a3b8';
}

/** Darken the base color by 10% so hover remains recognizable in either theme. */
export function getSessionEventHoverColor(type: SessionEventType, isDarkMode = false): string {
  const color = getSessionEventColor(type, isDarkMode);
  const hex = color.replace('#', '');
  const normalized =
    hex.length === 3
      ? hex
          .split('')
          .map(char => `${char}${char}`)
          .join('')
      : hex;
  if (normalized.length !== 6) return color;
  const value = Number.parseInt(normalized, 16);
  const channel = (shift: number) =>
    Math.max(0, Math.round(((value >> shift) & 255) * 0.9))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** Return the contributor-facing label shown in the event-type filter and dataset metadata. */
export function getSessionEventLabel(type: SessionEventType): string {
  return SESSION_EVENT_TYPES.find(eventType => eventType.id === type)?.label ?? type;
}

/** Use message-specific tooltip headings while falling back to the legend label. */
export function getSessionEventTooltipHeading(type: SessionEventType): string {
  return TOOLTIP_HEADINGS[type] ?? getSessionEventLabel(type);
}
