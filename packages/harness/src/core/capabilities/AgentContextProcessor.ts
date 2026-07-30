import type { ChatCompletionMessageParam } from 'openai/resources/chat';
import type { ThreadOverwriteContextEvent } from '../events/schema';
import type {
  AgentThreadAppendContext,
  ContextMessage,
  InternalCapabilityStateEvent,
  InternalPassthroughEvent,
} from '../runtime/AgentThread.types';
import type { CurrentContextUsage } from '../runtime/contextUsage';
import type { Sandbox } from '../sandbox/Sandbox';

/** Ambient thread snapshot passed Readonly to every capability processor hook. */
export interface AgentThreadExecutionContext {
  threadId: string;
  sandbox?: Sandbox | undefined;
  currentContextUsage: CurrentContextUsage;
  context: ContextMessage[];
}

export type AgentContextProcessorOverwriteContext = Omit<ThreadOverwriteContextEvent, 'thread_id'>;

export type AgentContextProcessorAppendContext = Omit<AgentThreadAppendContext, 'thread_id'>;

/** Processors omit thread_id — AgentThread stamps it (same as append/overwrite). */
export type AgentContextProcessorCapabilityState = Omit<InternalCapabilityStateEvent, 'thread_id'>;

export type AgentContextProcessorOutput =
  | AgentContextProcessorOverwriteContext
  | AgentContextProcessorAppendContext
  | InternalPassthroughEvent
  | AgentContextProcessorCapabilityState;

export interface PreSendContextProcessor {
  processPreSend(execution: Readonly<AgentThreadExecutionContext>): AsyncIterable<AgentContextProcessorAppendContext>;
}

// NOTE: Saved in Redis, Saved in AgentThread in memory. Persisted accross Agent Loop.
export interface PreLLMAgentContextProcessor {
  processPreLLM(execution: Readonly<AgentThreadExecutionContext>): AsyncIterable<AgentContextProcessorOutput>;
}

export interface PostToolCallAgentContextProcessor {
  processPostToolCall(execution: Readonly<AgentThreadExecutionContext>): AsyncIterable<AgentContextProcessorOutput>;
}

// NOTE: Not saved in Redis, Not saved in AgentThread in memory. Not persisted accross Agent Loop.
export interface PreLLMEphemeralAgentContextProcessor {
  processPreLLMEphemeral(input: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] | undefined;
}
