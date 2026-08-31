/**
 * Shared presentation model for the Sessions timeline.
 *
 * Raw server events are intentionally converted to this small, stable shape
 * before they reach Chart.js. That keeps transport compatibility and event
 * correlation out of the chart component and makes atoms easy to override.
 */

/** Events without a thread id belong to the root agent conversation. */
export const MAIN_THREAD_ID = 'main';

export type SessionEventType =
  'system' | 'user' | 'model' | 'tool_call' | 'approval' | 'sub_agent' | 'waiting_on_human' | 'error';

export type SessionEventTypeDefinition = {
  id: SessionEventType;
  label: string;
  color: string;
};

/**
 * One drawable interval on the timeline.
 *
 * Times are milliseconds relative to the session origin, not wall-clock
 * timestamps. Equal start/end times are rendered as markers; intervals become
 * horizontal bars. `turnIndex` groups intervals into turn backgrounds and
 * `threadId` assigns sub-agent work to its lane.
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
};

/** Canonical legend order, labels, and base colours for timeline event types. */
export const SESSION_EVENT_TYPES: SessionEventTypeDefinition[] = [
  { id: 'system', label: 'System', color: '#94a3b8' },
  { id: 'user', label: 'User', color: '#34d399' },
  { id: 'model', label: 'Model', color: '#3b82f6' },
  { id: 'tool_call', label: 'Tool call', color: '#f59e0b' },
  { id: 'approval', label: 'Approval / HITL', color: '#f472b6' },
  { id: 'sub_agent', label: 'Sub-agent', color: '#c084fc' },
  { id: 'waiting_on_human', label: 'Waiting on human', color: '#22d3ee' },
  { id: 'error', label: 'Error', color: '#f87171' },
];

/** Marker-like events have no meaningful elapsed duration in their tooltip. */
export const SESSION_EVENT_TOOLTIP_HIDE_DURATION = new Set<SessionEventType>(['system', 'user', 'error']);

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
  return `${Number((durationMs / 3_600_000).toPrecision(3))}h`;
}

/** Resolve a segment's color from the same registry used to build the legend. */
export function getSessionEventColor(type: SessionEventType): string {
  return SESSION_EVENT_TYPES.find(eventType => eventType.id === type)?.color ?? '#94a3b8';
}

/** Darken the base color by 10% so hover remains recognizable in either theme. */
export function getSessionEventHoverColor(type: SessionEventType): string {
  const hex = getSessionEventColor(type).replace('#', '');
  const normalized =
    hex.length === 3
      ? hex
          .split('')
          .map(char => `${char}${char}`)
          .join('')
      : hex;
  if (normalized.length !== 6) return getSessionEventColor(type);
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
