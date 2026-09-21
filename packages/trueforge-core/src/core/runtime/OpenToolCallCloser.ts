/**
 * OpenToolCallCloser - Context processor that closes unresolved tool calls.
 *
 * When an assistant message contains tool_calls but corresponding tool response
 * messages are missing (e.g., due to a failed or interrupted tool execution),
 * LLMs will reject the request. This processor detects such cases in the
 * **last** assistant message and appends dummy tool responses so the
 * conversation can continue.
 *
 * Uses is_thread_creation from InternalToolCallInfo to identify sub-agent
 * tool calls. Older persisted contexts without is_thread_creation follow the
 * ordinary non-thread-creation path (no compatibility fallback).
 *
 * Resume / user-action batches close only dangling regular calls. A user
 * message also closes pending approval, client-side, and thread-creation
 * calls so the new message can sit after a complete tool-call/response pair.
 */
import type {
  AgentContextProcessorAppendContext,
  AgentThreadExecutionContext,
  PreSendContextProcessor,
} from '../capabilities/AgentContextProcessor';
import type { InternalEnrichedAssistantMessage, InternalEnrichedToolCall, LLMToolMessage } from '../llm/LLMTypes';
import type { ContextMessage } from './AgentThread.types';
import { InternalEventType } from './AgentThread.types';
import { mergeCurrentContextUsage } from './contextUsage';
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
  userMessageIncoming: boolean;
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

  if (!input.userMessageIncoming && lastAssistant.tool_calls.some(isPendingUserAction)) {
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
    if (!input.userMessageIncoming && isThreadCreation(toolCall)) {
      continue;
    }
    closable.add(toolCall.id);
  }
  return closable;
}

export class OpenToolCallCloser implements PreSendContextProcessor {
  // eslint-disable-next-line @typescript-eslint/require-await -- async *: AsyncIterable contract; body is sync
  async *processPreSend(
    execution: Readonly<AgentThreadExecutionContext>,
    options: { userMessageIncoming: boolean },
  ): AsyncGenerator<AgentContextProcessorAppendContext, void, unknown> {
    const closableIds = [
      ...getClosableOpenToolCallIds({
        context: execution.context,
        userMessageIncoming: options.userMessageIncoming,
      }),
    ];
    if (closableIds.length === 0) {
      return;
    }

    const content = options.userMessageIncoming ? CANCELLED_TOOL_MESSAGE_CONTENT : DANGLING_TOOL_MESSAGE_CONTENT;
    const dummyToolMessages: LLMToolMessage[] = closableIds.map(toolCallId => ({
      role: 'tool',
      tool_call_id: toolCallId,
      content,
    }));

    const currentContextUsage = mergeCurrentContextUsage(
      execution.currentContextUsage,
      estimateTokensForContextMessages(dummyToolMessages),
    );

    yield {
      type: InternalEventType.AGENT_CONTEXT_APPEND,
      context: dummyToolMessages,
      output: [],
      current_context_usage: currentContextUsage,
    };
  }
}
