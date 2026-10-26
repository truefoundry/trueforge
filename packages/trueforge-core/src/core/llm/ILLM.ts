import type { ChatCompletionCreateParams, ChatCompletionCreateParamsStreaming } from 'openai/resources/chat';
import type { ExtendedChatCompletionChunk, RawAssistantMessageWithUsage } from './LLMTypes';

export type AgentMetadata = Record<string, string>;

/**
 * OpenAI chat-completion request shapes with `model` removed.
 * The bound ILLM client owns model identity (e.g. VercelAILLM providerConfig);
 * callers must not invent a model string just to satisfy OpenAI's required field.
 */
export type LLMCreateParams = Omit<ChatCompletionCreateParams, 'model'>;
export type LLMCreateParamsStreaming = Omit<ChatCompletionCreateParamsStreaming, 'model'>;

/** Per-call options for a single LLM request. */
export interface LLMRequestOptions {
  /** Extra outbound headers for this call only. */
  headers?: Record<string, string> | undefined;
  /**
   * Call tags merged into the TrueFoundry gateway `x-tfy-metadata` header for this call.
   * Ignored for non-TrueFoundry providers.
   */
  metadata?: AgentMetadata | undefined;
}

export interface ILLM {
  create(
    body: LLMCreateParamsStreaming,
    options?: LLMRequestOptions,
  ): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown>;
  createNonStream(body: LLMCreateParams, options?: LLMRequestOptions): Promise<RawAssistantMessageWithUsage>;
}
