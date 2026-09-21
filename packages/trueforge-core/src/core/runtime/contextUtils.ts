import dedent from 'dedent';
import type { ApprovalDecision } from '../events/schema';
import {
  EventType,
  type AgentApprovalDecisionMessage,
  type UserToolApprovalMessage,
  type UserToolResponseMessage,
} from '../events/schema';
import type {
  EnrichedToolCall,
  InternalEnrichedToolCall,
  InternalToolCallInfo,
  LLMToolMessage,
  LLMUserMessage,
  ToolInfo,
} from '../llm/LLMTypes';
import { UNKNOWN_TOOL_NAME } from '../llm/LLMTypes';
import { estimateTokensForString } from '../llm/usage';
import type {
  AgentThreadRuntimeSendInput,
  ContextMessage,
  InternalThreadDoneEvent,
  LLMContextMessage,
} from './AgentThread.types';
import type { CurrentContextUsage } from './contextUsage';
import type { AgentInputUserMessage } from './UserInputMessage';

export const SYSTEM_TAG_START = '<tfy-internal>';
const SYSTEM_TAG_END = '</tfy-internal>';
export const INTERNAL_SYSTEM_PROMPT = dedent`
Messages wrapped in tfy-internal tags contain information hidden from the user. The Agent must keep this information in mind when conversing with the user.
The Agent must never generate any content with tfy-internal tags.
The Agent cannot generate any content with tfy-internal tags.
`;

export function internalSystemTag(m: string): string {
  return SYSTEM_TAG_START + m + SYSTEM_TAG_END;
}

export function internalSystemMessage(m: string): LLMUserMessage {
  return { role: 'user' as const, content: internalSystemTag(m) };
}

export function isLLMContextMessage(msg: ContextMessage): msg is LLMContextMessage {
  return 'role' in msg;
}

export function isInternalSystemMessage(m: ContextMessage): boolean {
  if (!isLLMContextMessage(m)) {
    return false;
  }
  return m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(SYSTEM_TAG_START);
}

export function isApprovalDecisionMessage(msg: AgentThreadRuntimeSendInput): msg is UserToolApprovalMessage {
  return 'type' in msg && msg.type === EventType.USER_TOOL_APPROVAL;
}

function isUserToolApprovalDecisionMessage(msg: ContextMessage): msg is AgentApprovalDecisionMessage {
  // `'type' in msg` already narrows to AgentApprovalDecisionMessage (literal type).
  return 'type' in msg;
}

export function isClientSideToolResponseMessage(msg: AgentThreadRuntimeSendInput): msg is UserToolResponseMessage {
  return 'type' in msg && msg.type === EventType.USER_TOOL_RESPONSE;
}

export function isInputUserMessage(msg: AgentThreadRuntimeSendInput): msg is AgentInputUserMessage {
  return 'type' in msg && msg.type === EventType.USER_MESSAGE;
}

export function isLLMToolMessage(msg: AgentThreadRuntimeSendInput): msg is LLMToolMessage {
  // `'role' in msg` already narrows to LLMToolMessage among AgentThreadRuntimeSendInput.
  return 'role' in msg;
}

export function isInternalThreadDoneError(
  event: InternalThreadDoneEvent,
): event is InternalThreadDoneEvent & { status: 'error' } {
  return event.status === 'error';
}

export function scanApprovalDecisions(context: ContextMessage[]): Map<string, ApprovalDecision> {
  const decisions = new Map<string, ApprovalDecision>();
  for (const msg of context) {
    if (isUserToolApprovalDecisionMessage(msg)) {
      decisions.set(msg.tool_call_id, msg.approval);
    }
  }
  return decisions;
}

export function makeUnknownToolInfo(toolName: string): InternalToolCallInfo {
  return {
    type: 'mcp',
    mcp_server_id: UNKNOWN_TOOL_NAME,
    mcp_server_name: UNKNOWN_TOOL_NAME,
    original_tool_name: toolName,
    is_approval_required: false,
    is_client_side: false,
  };
}

export function toToolCallInfo(toolInfo: InternalToolCallInfo): ToolInfo {
  if (toolInfo.type === 'mcp') {
    return {
      type: toolInfo.type,
      name: toolInfo.original_tool_name,
      server_id: toolInfo.mcp_server_id,
      server_name: toolInfo.mcp_server_name,
    };
  }
  return {
    type: toolInfo.type,
    name: toolInfo.original_tool_name,
  };
}

export function toEnrichedToolCall(toolCall: InternalEnrichedToolCall): EnrichedToolCall {
  const { tool_info, ...rest } = toolCall;
  return { ...rest, tool_info: toToolCallInfo(tool_info) };
}

export function assistantMessageContentToStringForSubAgent(
  content: string | ({ type?: string; text?: string } | string)[] | null | undefined,
  errorMessage?: string,
): string {
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content.map(item => (typeof item === 'string' ? item : JSON.stringify(item))).join('');
  }
  if (errorMessage) {
    return text ? `${errorMessage}\n${text}` : errorMessage;
  }
  return text;
}

export function getThreadId(): string {
  return crypto.randomUUID();
}

export function estimateTokensForContextMessages(messages: ContextMessage[]): CurrentContextUsage {
  let tokenCount = 0;

  for (const b of messages) {
    if ('content' in b && b.content) {
      if (typeof b.content === 'string') {
        tokenCount += estimateTokensForString(b.content);
      } else if (Array.isArray(b.content)) {
        for (const part of b.content) {
          if ('text' in part && typeof part.text === 'string') {
            tokenCount += estimateTokensForString(part.text);
          }
        }
      }
    }

    if ('tool_calls' in b && b.tool_calls) {
      for (const toolCall of b.tool_calls) {
        tokenCount += estimateTokensForString(toolCall.function.name);
        tokenCount += estimateTokensForString(toolCall.function.arguments);
      }
    }

    if ('tool_call_id' in b && b.tool_call_id) {
      tokenCount += estimateTokensForString(b.tool_call_id);
    }
  }

  return {
    prompt_tokens: tokenCount,
    completion_tokens: 0,
  };
}
