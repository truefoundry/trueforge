import type { AgentContextProcessorAppendContext } from '../capabilities/AgentContextProcessor';
import type { InternalEnrichedAssistantMessage, InternalEnrichedToolCall, LLMToolMessage } from '../llm/LLMTypes';
import type { AgentThreadSendMode, ContextMessage } from './AgentThread.types';
import { InternalEventType } from './AgentThread.types';
import { mergeCurrentContextUsage, type CurrentContextUsage } from './contextUsage';
import { estimateTokensForContextMessages, isLLMContextMessage } from './contextUtils';

const DANGLING_TOOL_MESSAGE_CONTENT = JSON.stringify({
  error: 'Tool call was not executed. Please retry this tool call.',
});

const CANCELLED_TOOL_MESSAGE_CONTENT = 'Tool call was cancelled: a new turn was started.';

function isPendingUserAction(toolCall: InternalEnrichedToolCall): boolean {
  return toolCall.tool_info.is_approval_required === true || toolCall.tool_info.is_client_side === true;
}

function isThreadCreation(toolCall: InternalEnrichedToolCall): boolean {
  return toolCall.tool_info.is_thread_creation === true;
}

export function getClosableOpenToolCallIds(input: {
  context: ContextMessage[];
  mode: AgentThreadSendMode;
}): Set<string> {
  const lastIdx = input.context.findLastIndex(
    (msg): msg is InternalEnrichedAssistantMessage =>
      isLLMContextMessage(msg) && msg.role === 'assistant' && !!msg.tool_calls?.length,
  );
  if (lastIdx === -1) {
    return new Set();
  }

  const lastAssistant = input.context[lastIdx];
  if (lastAssistant === undefined || !isLLMContextMessage(lastAssistant) || lastAssistant.role !== 'assistant') {
    throw new Error('Unreachable');
  }
  if (!lastAssistant.tool_calls) {
    return new Set();
  }

  if (input.mode === 'resume' && lastAssistant.tool_calls.some(isPendingUserAction)) {
    return new Set();
  }

  const resolvedIds = new Set<string>();
  for (const msg of input.context.slice(lastIdx + 1)) {
    if (isLLMContextMessage(msg) && msg.role === 'tool') {
      resolvedIds.add(msg.tool_call_id);
    }
  }

  const closable = new Set<string>();
  for (const toolCall of lastAssistant.tool_calls) {
    if (resolvedIds.has(toolCall.id)) {
      continue;
    }
    if (input.mode === 'resume' && isThreadCreation(toolCall)) {
      continue;
    }
    closable.add(toolCall.id);
  }
  return closable;
}

/** Builds the protocol repair needed before a thread resumes or is interrupted. */
export function buildOpenToolCallClosure(
  input: Readonly<{
    context: ContextMessage[];
    currentContextUsage: CurrentContextUsage;
    mode: AgentThreadSendMode;
  }>,
): AgentContextProcessorAppendContext | undefined {
  const closableIds = [...getClosableOpenToolCallIds({ context: input.context, mode: input.mode })];
  if (closableIds.length === 0) {
    return undefined;
  }

  const content = input.mode === 'interrupt' ? CANCELLED_TOOL_MESSAGE_CONTENT : DANGLING_TOOL_MESSAGE_CONTENT;
  const dummyToolMessages: LLMToolMessage[] = closableIds.map(toolCallId => ({
    role: 'tool',
    tool_call_id: toolCallId,
    content,
  }));

  return {
    type: InternalEventType.AGENT_CONTEXT_APPEND,
    context: dummyToolMessages,
    output: [],
    current_context_usage: mergeCurrentContextUsage(
      input.currentContextUsage,
      estimateTokensForContextMessages(dummyToolMessages),
    ),
  };
}
