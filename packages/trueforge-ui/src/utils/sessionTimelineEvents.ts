/**
 * Small helpers that read raw gateway events for the Sessions timeline.
 *
 * Keep parsing / label text here so segment-building and Chart.js stay dumb
 * about camelCase vs snake_case and MCP argument shapes.
 */
import { formatTimelineDuration, MAIN_THREAD_ID } from './sessionEventTimeline.js';
import type { SessionTurnView } from './sessionTurnViews.js';
import {
  MCP_META_TOOLS,
  mcpDisplayName,
  parseMcpToolArgs,
  parseSandboxArgs,
  SANDBOX_TOOL_NAMES,
} from './toolCallParsing.js';

/** Loose gateway event bag; we only rely on `type` plus a few known fields. */
export type TimelineEvent = Record<string, unknown> & { type: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null;
}

export function asTimelineEvent(event: unknown): TimelineEvent | null {
  return isRecord(event) && typeof event.type === 'string' ? { ...event, type: event.type } : null;
}

/** Prefer camelCase, fall back to snake_case (gateway wire vs SDK shapes). */
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

/** Cancel reason on turn.done (`client-cancelled`, etc.). */
export function terminalReason(state: unknown): string {
  return isRecord(state) ? (readString(state, 'reason', 'reason') ?? '') : '';
}

/** Sub-agent thread.done error text (`ThreadStateError.error`). */
export function terminalThreadError(state: unknown): string {
  if (!isRecord(state)) return '';
  if (typeof state.error === 'string' && state.error.length > 0) return state.error;
  return terminalMessage(state);
}

/** Cancel mid-stream can persist thread.done error "LLM stream aborted"; not a real failure. */
export function isAbortShapedThreadError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === 'llm stream aborted' ||
    normalized === 'aborterror' ||
    normalized.includes('stream aborted') ||
    normalized.includes('aborterror')
  );
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

/**
 * Short MCP label for timeline copy: `linear/save_comment`.
 * Prefers the inner tool from `call_tool` args over the wrapper name.
 */
export function mcpToolSlashLabel(toolCall: Record<string, unknown> | undefined): string {
  if (toolCall == null) return '';
  const fn = isRecord(toolCall.function) ? toolCall.function : undefined;
  const name = typeof fn?.name === 'string' ? fn.name : '';
  const argumentsJson = typeof fn?.arguments === 'string' ? fn.arguments : undefined;
  if (MCP_META_TOOLS.has(name)) {
    const { mcpServer, innerToolName } = parseMcpToolArgs(argumentsJson);
    const slash = [mcpServer, innerToolName].filter(part => part != null && part.length > 0).join('/');
    if (slash.length > 0) return slash;
  }
  return name;
}

/**
 * Collapse duplicate approval tools into tooltip lines.
 * Example input: three `linear/save_comment` → `linear/save_comment (3)`.
 */
export function summarizeApprovalRequiredTools(toolLabels: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const label of toolLabels) {
    const trimmed = label.trim();
    if (trimmed.length === 0) continue;
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  if (counts.size === 0) return 'Approval required';
  return [...counts.entries()].map(([name, count]) => (count > 1 ? `${name} (${count})` : name)).join('\n');
}

/** User allow/deny copy, optionally with the tool name: `linear/save_comment · approved`. */
export function summarizeToolApproval(approval: unknown, { toolLabel }: { toolLabel?: string } = {}): string {
  const record = isRecord(approval) ? approval : undefined;
  const reason = typeof record?.reason === 'string' ? record.reason.trim() : '';
  const statusPart =
    record?.status === 'deny'
      ? reason.length > 0
        ? `Denied: ${reason}`
        : 'Denied'
      : record?.status === 'allow'
        ? 'approved'
        : 'Tool approval';
  const label = toolLabel?.trim() ?? '';
  return label.length > 0 ? `${label} · ${statusPart}` : statusPart === 'approved' ? 'Approved' : statusPart;
}

/**
 * Policy marker copy, e.g. `linear/save_comment · allow_session · 10m`
 * when expire_at is present.
 */
export function summarizeToolApprovalPolicy(event: TimelineEvent): string {
  const policies = event.policies;
  if (!Array.isArray(policies) || policies.length === 0) return 'Approval policy';
  const eventMs = parseTimestamp(eventCreatedAt(event));
  const parts = policies.flatMap(policy => {
    if (!isRecord(policy)) return [];
    const server = readString(policy, 'serverName', 'server_name') ?? '';
    const name = typeof policy.name === 'string' ? policy.name : '';
    const policyBody = isRecord(policy.policy) ? policy.policy : undefined;
    const policyType = typeof policyBody?.type === 'string' ? policyBody.type : '';
    const tool = [server, name].filter(part => part.length > 0).join('/');
    if (tool.length === 0 && policyType.length === 0) return [];
    const expireAt = policyBody == null ? undefined : readString(policyBody, 'expireAt', 'expire_at');
    const expireMs = parseTimestamp(expireAt);
    const duration =
      expireMs != null && eventMs != null && expireMs > eventMs ? formatTimelineDuration(expireMs - eventMs) : '';
    const base = policyType.length > 0 ? `${tool || 'tool'} · ${policyType}` : tool;
    return [duration.length > 0 ? `${base} · ${duration}` : base];
  });
  return parts.length > 0 ? parts.join(', ') : 'Approval policy';
}

export function getTurnInputSummary(turn: SessionTurnView): string {
  const item = turnInputItems(turn.created).find(entry => typeof entry.type === 'string');
  if (item == null) return '';
  if (item.type === 'user.tool_approval') return summarizeToolApproval(item.approval);
  if (item.type === 'user.tool_response') return extractText(item.content) || 'Tool response';
  if (item.type === 'user.mcp_auth_continue') return 'MCP authorization completed';
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
  const argumentsJson = typeof fn?.arguments === 'string' ? fn.arguments : undefined;
  if (SANDBOX_TOOL_NAMES.has(name) || name === 'code_sandbox') {
    const intent = parseSandboxArgs(argumentsJson).intent?.trim();
    const sandboxTool = `Sandbox: ${name}`;
    return intent != null && intent.length > 0 ? `${sandboxTool} - ${intent}` : sandboxTool;
  }
  // Deferred MCP wrappers store the real tool in args; surface it like ToolCallContainer.
  if (MCP_META_TOOLS.has(name)) {
    const { mcpServer, innerToolName } = parseMcpToolArgs(argumentsJson);
    return mcpDisplayName(name, mcpServer, innerToolName);
  }
  return name;
}
