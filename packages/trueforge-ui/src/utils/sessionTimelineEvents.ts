import { MAIN_THREAD_ID } from './sessionEventTimeline.js';
import type { SessionTurnView } from './sessionTurnViews.js';
import { parseSandboxArgs, SANDBOX_TOOL_NAMES } from './toolCallParsing.js';

export type TimelineEvent = Record<string, unknown> & { type: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

export function asTimelineEvent(event: unknown): TimelineEvent | null {
  return isRecord(event) && typeof event.type === 'string' ? { ...event, type: event.type } : null;
}

export function readString(record: Record<string, unknown>, camel: string, snake: string): string | undefined {
  const camelValue = record[camel];
  if (typeof camelValue === 'string' && camelValue.length > 0) return camelValue;
  const snakeValue = record[snake];
  return typeof snakeValue === 'string' && snakeValue.length > 0 ? snakeValue : undefined;
}

export function parseTimestamp(timestamp: string | undefined): number | null {
  if (timestamp == null) return null;
  const timestampMs = Date.parse(timestamp);
  return Number.isNaN(timestampMs) ? null : timestampMs;
}

export function eventCreatedAt(event: TimelineEvent): string | undefined {
  return readString(event, 'createdAt', 'created_at');
}

export function eventThreadId(event: TimelineEvent): string {
  return readString(event, 'threadId', 'thread_id') ?? MAIN_THREAD_ID;
}

export function eventId(event: TimelineEvent): string {
  return typeof event.id === 'string' ? event.id : `${event.type}-${eventCreatedAt(event) ?? 'unknown'}`;
}

export function extractText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .flatMap(item => {
      if (typeof item === 'string') return item ? [item] : [];
      if (isRecord(item) && typeof item.text === 'string' && item.text.length > 0) return [item.text];
      return [];
    })
    .join('\n')
    .trim();
}

export function toolCallsOf(event: TimelineEvent): Record<string, unknown>[] {
  const toolCalls = event.toolCalls ?? event.tool_calls;
  return Array.isArray(toolCalls) ? toolCalls.filter(isRecord) : [];
}

export function parentToolCallId(event: TimelineEvent): string | undefined {
  const parent = isRecord(event.parent) ? event.parent : undefined;
  return parent == null ? undefined : readString(parent, 'toolCallId', 'tool_call_id');
}

export function terminalCompletedAt(state: unknown): string | undefined {
  return isRecord(state) ? readString(state, 'completedAt', 'completed_at') : undefined;
}

export function terminalMessage(state: unknown): string {
  return isRecord(state) && typeof state.message === 'string' ? state.message : '';
}

export function terminalStatus(state: unknown): string | undefined {
  return isRecord(state) && typeof state.status === 'string' ? state.status : undefined;
}

function turnInputItems(
  created: SessionTurnView['created'],
): Array<{ type?: unknown; content?: unknown; approval?: unknown }> {
  const input = Reflect.get(created, 'input');
  if (!Array.isArray(input)) return [];
  return input.flatMap(item => {
    if (typeof item !== 'object' || item == null) return [];
    return [
      {
        ...('type' in item ? { type: item.type } : {}),
        ...('content' in item ? { content: item.content } : {}),
        ...('approval' in item ? { approval: item.approval } : {}),
      },
    ];
  });
}

export function getTurnInputType(turn: SessionTurnView): string {
  const item = turnInputItems(turn.created).find(entry => typeof entry.type === 'string');
  return typeof item?.type === 'string' ? item.type : 'user.message';
}

export function getTurnInputSummary(turn: SessionTurnView): string {
  const item = turnInputItems(turn.created).find(entry => typeof entry.type === 'string');
  if (item == null) return '';
  if (item.type === 'user.tool_approval') {
    const approval = isRecord(item.approval) ? item.approval : undefined;
    const reason = typeof approval?.reason === 'string' ? approval.reason.trim() : '';
    if (approval?.status === 'deny') return reason.length > 0 ? `Denied: ${reason}` : 'Denied';
    if (approval?.status === 'allow') return 'Approved';
    return 'Tool approval';
  }
  if (item.type === 'user.tool_response') return extractText(item.content) || 'Tool response';
  return extractText(item.content) || 'User message';
}

export function getSubAgentDescription(event: TimelineEvent): string {
  const title = typeof event.title === 'string' ? event.title.trim() : '';
  const agentInfo = isRecord(event.agentInfo)
    ? event.agentInfo
    : isRecord(event.agent_info)
      ? event.agent_info
      : undefined;
  const name = typeof agentInfo?.name === 'string' ? agentInfo.name.trim() : '';
  const input = typeof agentInfo?.input === 'string' ? agentInfo.input.trim() : '';
  return title || name || input;
}

export function toolCallDescription(toolCall: Record<string, unknown>): string {
  const fn = isRecord(toolCall.function) ? toolCall.function : undefined;
  const name = typeof fn?.name === 'string' ? fn.name : '';
  if (SANDBOX_TOOL_NAMES.has(name) || name === 'code_sandbox') {
    const argumentsJson = typeof fn?.arguments === 'string' ? fn.arguments : undefined;
    const intent = parseSandboxArgs(argumentsJson).intent?.trim();
    return intent != null && intent.length > 0 ? intent : name;
  }
  return name;
}
