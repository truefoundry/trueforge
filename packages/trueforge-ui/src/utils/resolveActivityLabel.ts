import { CONTEXT_COMPACTION_DATA_NAME, isContextCompactionPartData } from '@truefoundry/trueforge-assistant-ui-runtime';

import {
  hasPendingToolApproval,
  parseMcpToolArgs,
  parseSandboxArgs,
  SANDBOX_TOOL_NAMES,
  SUB_AGENT_TOOL_NAME,
} from './toolCallParsing.js';

export const DEFAULT_ACTIVITY_LABEL = 'Working...';

const MAX_INTENT_LENGTH = 60;

export type ActivityPart = {
  type: string;
  name?: string;
  data?: unknown;
  toolName?: string;
  argsText?: string;
  text?: string;
  status?: { type: string };
  result?: unknown;
  approval?: { approved?: boolean; resolution?: 'cancelled' | 'expired' };
  toolCallId?: string;
  messages?: readonly { content: readonly ActivityPart[] }[];
};

// Nested message content parts carry no status: derive it from the approval gate, then from the result.
function toolStatusType(part: ActivityPart): string {
  if (part.status) return part.status.type;
  if (hasPendingToolApproval(part.approval)) return 'requires-action';
  return part.result === undefined ? 'running' : 'complete';
}

function trimTrailingEllipsis(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === '.' || text[end - 1] === '…')) end--;
  return text.slice(0, end);
}

function isRunningSubAgent(part: ActivityPart): boolean {
  return part.type === 'tool-call' && part.toolName === SUB_AGENT_TOOL_NAME && toolStatusType(part) === 'running';
}

function isRunningSummarization(part: ActivityPart): boolean {
  return (
    part.type === 'data' &&
    part.name === CONTEXT_COMPACTION_DATA_NAME &&
    isContextCompactionPartData(part.data) &&
    part.data.status === 'running'
  );
}

function toolLabel(part: ActivityPart): string {
  const toolName = part.toolName ?? 'tool';
  if (SANDBOX_TOOL_NAMES.has(toolName)) {
    const intent = trimTrailingEllipsis(parseSandboxArgs(part.argsText).intent?.trim() ?? '');
    if (!intent) return 'Running command...';
    return `${intent.length > MAX_INTENT_LENGTH ? `${intent.slice(0, MAX_INTENT_LENGTH)}…` : intent} · ${toolName}`;
  }
  const { innerToolName } = parseMcpToolArgs(part.argsText);
  return `Running ${innerToolName ?? toolName}...`;
}

/** Detailed activity for a sub-agent card, whose tool calls are hidden while collapsed. */
export function resolveActivityLabel(parts: readonly ActivityPart[]): string {
  const last = parts[parts.length - 1];
  if (!last) return DEFAULT_ACTIVITY_LABEL;

  // Only claim "Thinking" while reasoning is actually streaming.
  if (last.type === 'reasoning') return 'Thinking...';
  if (isRunningSummarization(last)) return 'Summarizing context...';
  if (last.type !== 'tool-call') return DEFAULT_ACTIVITY_LABEL;

  const statusType = toolStatusType(last);
  if (statusType === 'requires-action') return 'Waiting for your approval';
  if (statusType !== 'running') return DEFAULT_ACTIVITY_LABEL;

  if (last.toolName === SUB_AGENT_TOOL_NAME) {
    const nestedParts = last.messages?.[last.messages.length - 1]?.content ?? [];
    return `Sub-agent: ${resolveActivityLabel(nestedParts)}`;
  }
  return toolLabel(last);
}

/**
 * Activity the main loader is timing. Null while the wait is on the user or a sub-agent.
 * A new key restarts the "taking longer than expected" clock.
 */
export function loaderActivityKey(parts: readonly ActivityPart[]): string | null {
  if (parts.some(isRunningSubAgent)) return null;

  const last = parts[parts.length - 1];
  if (!last) return 'model';
  if (last.type === 'reasoning') return 'thinking';
  if (isRunningSummarization(last)) return 'summarizing';
  if (last.type === 'tool-call') {
    const statusType = toolStatusType(last);
    if (statusType === 'requires-action') return null;
    if (statusType === 'running') return `tool:${last.toolCallId ?? last.toolName ?? 'tool'}`;
  }
  return 'model';
}

/** Stream fingerprint for the slow-activity clock; changes while tokens or tool args arrive. */
// This is to avoid showing `taking longer..` label when events are arriving
export function loaderActivityProgress(parts: readonly ActivityPart[]): string {
  const last = parts[parts.length - 1];
  if (!last) return `${parts.length}:empty`;
  if (last.type === 'reasoning') return `${parts.length}:reasoning:${last.text?.length ?? 0}`;
  if (last.type === 'tool-call') return `${parts.length}:tool-call:${last.argsText?.length ?? 0}`;
  return `${parts.length}:${last.type}`;
}

/** Main-thread loader: the running tool row already shows its own detail, so stay generic. */
export function resolveLoaderLabel(parts: readonly ActivityPart[]): string {
  const subAgentCount = parts.filter(isRunningSubAgent).length;
  if (subAgentCount > 1) return `Waiting for ${subAgentCount} sub-agents...`;
  if (subAgentCount === 1) return 'Waiting for sub-agent...';

  const last = parts[parts.length - 1];
  if (last?.type === 'reasoning') return 'Thinking...';
  if (last && isRunningSummarization(last)) return 'Summarizing context...';
  return DEFAULT_ACTIVITY_LABEL;
}
