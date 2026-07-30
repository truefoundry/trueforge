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
 * tool calls (which should remain open); does NOT use SUB_AGENTS_SERVER_ID.
 * Older persisted contexts without is_thread_creation follow the ordinary
 * non-thread-creation path (no compatibility fallback).
 */
import type {
  AgentContextProcessorAppendContext,
  AgentThreadExecutionContext,
  PreSendContextProcessor,
} from '../capabilities/AgentContextProcessor';
import type { InternalEnrichedAssistantMessage, LLMToolMessage } from '../llm/LLMTypes';
import type { ContextMessage } from './AgentThread.types';
import { InternalEventType } from './AgentThread.types';
import { mergeCurrentContextUsage } from './contextUsage';
import { estimateTokensForContextMessages, isLLMContextMessage } from './contextUtils';

const DUMMY_TOOL_MESSAGE_CONTENT = JSON.stringify({
  error: 'Tool call was not executed. Please retry this tool call.',
});

export function getClosableOpenToolCallIds(context: ContextMessage[]): Set<string> {
  const lastIdx = context.findLastIndex(
    (msg): msg is InternalEnrichedAssistantMessage =>
      isLLMContextMessage(msg) && msg.role === 'assistant' && !!msg.tool_calls?.length,
  );
  if (lastIdx === -1) {
    return new Set();
  }

  const lastAssistant = context[lastIdx];
  if (lastAssistant === undefined || !isLLMContextMessage(lastAssistant) || lastAssistant.role !== 'assistant') {
    throw new Error('Unreachable');
  }
  if (!lastAssistant.tool_calls) {
    return new Set();
  }

  if (
    lastAssistant.tool_calls.some(
      tc => tc.tool_info.is_approval_required === true || tc.tool_info.is_client_side === true,
    )
  ) {
    return new Set();
  }

  const requestedIds = new Set(
    lastAssistant.tool_calls.filter(tc => tc.tool_info.is_thread_creation !== true).map(tc => tc.id),
  );

  const messagesAfterAssistant = context.slice(lastIdx + 1);
  for (const msg of messagesAfterAssistant) {
    if (isLLMContextMessage(msg) && msg.role === 'tool') {
      requestedIds.delete(msg.tool_call_id);
    }
  }

  return requestedIds;
}

export class OpenToolCallCloser implements PreSendContextProcessor {
  // eslint-disable-next-line @typescript-eslint/require-await -- async *: AsyncIterable contract; body is sync
  async *processPreSend(
    execution: Readonly<AgentThreadExecutionContext>,
  ): AsyncGenerator<AgentContextProcessorAppendContext, void, unknown> {
    const requestedIds = getClosableOpenToolCallIds(execution.context);
    if (requestedIds.size === 0) {
      return;
    }

    const dummyToolMessages: LLMToolMessage[] = [...requestedIds].map(toolCallId => ({
      role: 'tool',
      tool_call_id: toolCallId,
      content: DUMMY_TOOL_MESSAGE_CONTENT,
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
