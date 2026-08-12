import type { ToolApprovalOption as AuiToolApprovalOption, ToolCallMessagePartProps } from '@assistant-ui/react';
import { parse as parsePartialJson } from 'partial-json';

import type { ToolCallStatus } from '../atoms/ToolCallCard.js';

export type ApprovalOptionView = {
  id: string;
  label: string;
  isAllow: boolean;
  grants?: unknown;
  confirm?: Record<string, unknown>;
};

export const SUB_AGENT_TOOL_NAME = 'create_sub_agent';
export const ASK_USER_TOOL_NAME = 'ask_user_question';

/** Tool names that should be rendered as a sandbox execution card. */
export const SANDBOX_TOOL_NAMES = new Set(['exec', 'sandbox_exec']);

/** MCP meta-tools that wrap actual tool calls. */
export const MCP_META_TOOLS = new Set(['call_tool', 'list_tools', 'get_tool_info']);

const APPROVAL_OPTION_DEFAULT_LABELS: Record<string, string> = {
  'allow-once': 'Allow',
  'allow-always': 'Always allow',
  'reject-once': 'Deny',
  'reject-always': 'Always deny',
};

const isAllowKind = (kind: string) => kind === 'allow-once' || kind === 'allow-always';

type JsonParseResult = { success: true; value: unknown; isPartial: boolean } | { success: false };

function parseJsonIncrementally(content: string): JsonParseResult {
  try {
    return { success: true, value: JSON.parse(content), isPartial: false };
  } catch {
    const trimmed = content.trim();
    if (trimmed[0] !== '{' && trimmed[0] !== '[') return { success: false };

    try {
      return { success: true, value: parsePartialJson(content), isPartial: true };
    } catch {
      return { success: false };
    }
  }
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function parseAskUserQuestionArgs(argsText: string | undefined): {
  question?: string;
  options?: string[];
} {
  if (!argsText) return {};
  try {
    const parsed: unknown = JSON.parse(argsText);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const question = typeof record.question === 'string' ? record.question : undefined;
    const options = Array.isArray(record.options)
      ? record.options.filter((item): item is string => typeof item === 'string')
      : undefined;
    return { question, options };
  } catch {
    return {};
  }
}

export function getAskUserAnswerResult(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined;
  if (typeof result === 'string') {
    const trimmed = result.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof result === 'object' && 'content' in result) {
    const content = (result as { content?: unknown }).content;
    if (typeof content === 'string' && content.trim()) {
      return content.trim();
    }
  }
  return undefined;
}

export function hasPendingAskUserResponse(part: Pick<ToolCallMessagePartProps, 'interrupt' | 'result'>): boolean {
  return part.interrupt != null && part.result === undefined;
}

export function hasPendingToolApproval(
  approval: { approved?: boolean; resolution?: 'cancelled' | 'expired' } | undefined,
) {
  return approval != null && approval.approved === undefined && approval.resolution === undefined;
}

export function buildApprovalOptions(options: readonly AuiToolApprovalOption[] | undefined): ApprovalOptionView[] {
  const declared = options?.filter(o => Object.hasOwn(APPROVAL_OPTION_DEFAULT_LABELS, o.kind));
  if (declared && declared.length > 0) {
    const allow = declared.filter(o => isAllowKind(o.kind));
    const reject = declared.filter(o => !isAllowKind(o.kind));
    const mapped: ApprovalOptionView[] = [...allow, ...reject].map(o => ({
      id: o.id,
      label: o.label ?? APPROVAL_OPTION_DEFAULT_LABELS[o.kind] ?? o.id,
      isAllow: isAllowKind(o.kind),
      grants: o.grants,
      confirm: o.confirm != null ? (typeof o.confirm === 'object' ? o.confirm : {}) : undefined,
    }));
    if (reject.length === 0) {
      mapped.push({ id: '__deny', label: 'Deny', isAllow: false, confirm: {} });
    }
    return mapped;
  }
  return [
    { id: '__allow', label: 'Allow', isAllow: true },
    { id: '__deny', label: 'Deny', isAllow: false, confirm: {} },
  ];
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const seconds = ms / 1000;
  if (seconds < 10) return `${(Math.floor(seconds * 10) / 10).toFixed(1)}s`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

export function toStatus(statusType: string | undefined): ToolCallStatus {
  if (statusType === 'complete') return 'success';
  if (statusType === 'incomplete') return 'error';
  return 'running';
}

export function parseSandboxArgs(argsText: string | undefined): {
  command?: string;
  intent?: string;
  argsJson?: string;
} {
  if (!argsText) return {};
  const parsed = parseJsonIncrementally(argsText);
  if (!parsed.success || !isUnknownRecord(parsed.value)) return { argsJson: argsText };

  return {
    command: typeof parsed.value.command === 'string' ? parsed.value.command : undefined,
    intent: typeof parsed.value.intent === 'string' ? parsed.value.intent : undefined,
    argsJson: parsed.isPartial ? argsText : JSON.stringify(parsed.value, null, 2),
  };
}

export function parseSandboxResult(result: string | undefined): {
  exitCode?: number | null;
  resultText?: string;
  resultJson?: string;
} {
  if (result === undefined) return {};
  const parsed = parseJsonIncrementally(result);
  if (!parsed.success || !isUnknownRecord(parsed.value)) return { resultText: result };

  const response = isUnknownRecord(parsed.value.response) ? parsed.value.response : undefined;
  const exitCode = typeof response?.exitCode === 'number' ? response.exitCode : null;
  const resultText = typeof response?.result === 'string' ? response.result : undefined;
  return {
    exitCode,
    resultText,
    resultJson: parsed.isPartial ? result : JSON.stringify(parsed.value, null, 2),
  };
}

export function parseMcpToolArgs(argsText: string | undefined): {
  mcpServer?: string;
  innerToolName?: string;
  input?: unknown;
} {
  if (!argsText) return {};
  try {
    const parsed = JSON.parse(argsText) as {
      mcp_server?: string;
      tool_name?: string;
      input?: unknown;
    };
    return {
      mcpServer: parsed.mcp_server,
      innerToolName: parsed.tool_name,
      input: parsed.input,
    };
  } catch {
    return {};
  }
}

export function getJsonDisplayValue(content: string | undefined): {
  value: string;
  isJson: boolean;
} {
  if (!content?.trim()) return { value: '', isJson: false };
  const trimmed = content.trim();
  if (trimmed[0] !== '{' && trimmed[0] !== '[') {
    return { value: content, isJson: false };
  }
  try {
    const parsed: unknown = JSON.parse(content);
    return { value: JSON.stringify(parsed, null, 2), isJson: true };
  } catch {
    return { value: content, isJson: false };
  }
}

export function getToolResultContent(content: unknown): {
  data: string;
  isJson: boolean;
} {
  try {
    if (!content) return { isJson: false, data: '' };

    const parsedResult = typeof content === 'string' && content.trim().startsWith('{') ? JSON.parse(content) : content;

    if (
      typeof parsedResult === 'object' &&
      parsedResult != null &&
      Array.isArray((parsedResult as { content?: unknown }).content)
    ) {
      const text = (parsedResult as { content: Array<{ text?: unknown }> }).content[0]?.text || '';
      const display = getJsonDisplayValue(typeof text === 'string' ? text : JSON.stringify(text));
      return { data: display.value, isJson: display.isJson };
    }
    const display = getJsonDisplayValue(typeof parsedResult === 'string' ? parsedResult : JSON.stringify(parsedResult));
    return { data: display.value, isJson: display.isJson };
  } catch {
    return { data: String(content), isJson: false };
  }
}

export function resolveSubAgentMeta(part: ToolCallMessagePartProps): {
  agentName: string;
  instruction: string;
  stepCount: number;
} {
  const artifactSubAgent = (
    part as {
      artifact?: {
        subAgents?: Array<{
          title?: string;
          agentInfo?: { name?: string; input?: string };
        }>;
      };
    }
  ).artifact?.subAgents?.[0];
  const firstNested = part.messages?.[0];
  const subAgent = (
    firstNested?.metadata?.custom as { subAgent?: { title?: string; name?: string; input?: string } } | undefined
  )?.subAgent;
  return {
    agentName:
      subAgent?.title ??
      subAgent?.name ??
      artifactSubAgent?.title ??
      artifactSubAgent?.agentInfo?.name ??
      part.toolName,
    instruction: subAgent?.input ?? artifactSubAgent?.agentInfo?.input ?? '',
    stepCount: part.messages?.length ?? 0,
  };
}

export function mcpDisplayName(
  toolName: string,
  mcpServer: string | undefined,
  innerToolName: string | undefined,
): string {
  if (toolName === 'call_tool' && innerToolName) {
    return mcpServer ? `call_tool: ${innerToolName} (${mcpServer})` : `call_tool: ${innerToolName}`;
  }
  if (toolName === 'get_tool_info' && innerToolName && mcpServer) {
    return `get_tool_info: ${innerToolName} (${mcpServer})`;
  }
  return toolName;
}
