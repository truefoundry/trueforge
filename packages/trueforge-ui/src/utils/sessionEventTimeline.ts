export const MAIN_THREAD_ID = 'main';

export type SessionEventType =
  'system' | 'user' | 'model' | 'tool_call' | 'approval' | 'sub_agent' | 'waiting_on_human' | 'error';

export type SessionEventTypeDefinition = {
  id: SessionEventType;
  label: string;
  color: string;
};

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

export const SESSION_EVENT_TOOLTIP_HIDE_DURATION = new Set<SessionEventType>(['system', 'user', 'error']);

const TOOLTIP_HEADINGS: Partial<Record<SessionEventType, string>> = {
  user: 'User Message',
  model: 'Model Response',
};

export function formatTimelineDuration(durationMs: number): string {
  if (durationMs <= 0) return '0ms';
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${Number((durationMs / 1_000).toPrecision(3))}s`;
  if (durationMs < 3_600_000) return `${Number((durationMs / 60_000).toPrecision(3))}m`;
  return `${Number((durationMs / 3_600_000).toPrecision(3))}h`;
}

export function getSessionEventColor(type: SessionEventType): string {
  return SESSION_EVENT_TYPES.find(eventType => eventType.id === type)?.color ?? '#94a3b8';
}

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

export function getSessionEventLabel(type: SessionEventType): string {
  return SESSION_EVENT_TYPES.find(eventType => eventType.id === type)?.label ?? type;
}

export function getSessionEventTooltipHeading(type: SessionEventType): string {
  return TOOLTIP_HEADINGS[type] ?? getSessionEventLabel(type);
}
