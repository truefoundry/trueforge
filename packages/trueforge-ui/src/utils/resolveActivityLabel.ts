import { parseMcpToolArgs, SANDBOX_TOOL_NAMES, SUB_AGENT_TOOL_NAME } from './toolCallParsing.js';

export const DEFAULT_ACTIVITY_LABEL = 'Working...';

export type ActivityPart = {
  type: string;
  toolName?: string;
  argsText?: string;
  status?: { type: string };
  result?: unknown;
  messages?: readonly { content: readonly ActivityPart[] }[];
};

// Nested message content parts carry no status; an unresolved result means still running.
function toolStatusType(part: ActivityPart): string {
  return part.status?.type ?? (part.result === undefined ? 'running' : 'complete');
}

function isRunningSubAgent(part: ActivityPart): boolean {
  return part.type === 'tool-call' && part.toolName === SUB_AGENT_TOOL_NAME && toolStatusType(part) === 'running';
}

function toolLabel(part: ActivityPart): string {
  const toolName = part.toolName ?? 'tool';
  if (SANDBOX_TOOL_NAMES.has(toolName)) return 'Running command...';
  const { innerToolName } = parseMcpToolArgs(part.argsText);
  return `Running ${innerToolName ?? toolName}...`;
}

/** Describes what the agent is doing right now, from the newest part of the running message. */
export function resolveActivityLabel(parts: readonly ActivityPart[]): string {
  const runningSubAgents = parts.filter(isRunningSubAgent);
  if (runningSubAgents.length > 1) return `Waiting for ${runningSubAgents.length} sub-agents...`;

  const last = parts[parts.length - 1];
  if (!last) return DEFAULT_ACTIVITY_LABEL;

  // Only claim "Thinking" while reasoning is actually streaming.
  if (last.type === 'reasoning') return 'Thinking...';
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
