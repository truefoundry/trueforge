import { z } from '@hono/zod-openapi';
import OpenAI from 'openai';
import type { RequestOptions } from 'openai/core';
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat';
import type { Logger } from 'winston';
import { extractErrorLogFields } from '../util/errorLogFields';
import type { ILLM } from './ILLM';
import {
  type CompletionUsage,
  type ExtendedChatCompletionChunk,
  getEmptyUsage,
  type RawAssistantMessage,
  type RawAssistantMessageWithUsage,
} from './LLMTypes';

/** Gateway wire usage. Private; normalized once into CompletionUsage. */
const OptionalGatewayTokenCountSchema = z.number().int().nonnegative().optional().catch(undefined);
const OptionalGatewayCostSchema = z.number().nonnegative().optional().catch(undefined);

const GatewayChatCompletionUsageSchema = z.object({
  completion_tokens: OptionalGatewayTokenCountSchema,
  prompt_tokens: OptionalGatewayTokenCountSchema,
  total_tokens: OptionalGatewayTokenCountSchema,
  completion_tokens_details: z
    .object({
      reasoning_tokens: OptionalGatewayTokenCountSchema,
    })
    .optional()
    .catch(undefined),
  prompt_tokens_details: z
    .object({
      cached_tokens: OptionalGatewayTokenCountSchema,
    })
    .optional()
    .catch(undefined),
  cache_read_input_tokens: OptionalGatewayTokenCountSchema,
  cache_creation_input_tokens: OptionalGatewayTokenCountSchema,
  costInUSD: OptionalGatewayCostSchema,
});

type GatewayChatCompletionUsage = z.infer<typeof GatewayChatCompletionUsageSchema>;

/** One-shot translation: gateway wire → canonical harness CompletionUsage. */
function normalizeGatewayUsage(usage: unknown): CompletionUsage {
  const result = GatewayChatCompletionUsageSchema.safeParse(usage);
  const parsed: GatewayChatCompletionUsage = result.success ? result.data : {};
  return {
    input_tokens: parsed.prompt_tokens ?? 0,
    output_tokens: parsed.completion_tokens ?? 0,
    total_tokens: parsed.total_tokens ?? 0,
    cache_read_tokens: parsed.cache_read_input_tokens ?? parsed.prompt_tokens_details?.cached_tokens,
    cache_write_tokens: parsed.cache_creation_input_tokens,
    reasoning_tokens: parsed.completion_tokens_details?.reasoning_tokens,
    cost_in_usd: parsed.costInUSD,
  };
}

function toHarnessChunk(event: ChatCompletionChunk): ExtendedChatCompletionChunk {
  const { usage, ...rest } = event;
  if (usage == null) {
    return rest;
  }
  return {
    ...rest,
    usage: normalizeGatewayUsage(usage),
  };
}

/** Static headers, or a resolver invoked on every request. */
export type LLMHeaders = Record<string, string> | (() => Record<string, string>);

export interface OpenAILLMConfig {
  /** Base URL of an OpenAI-compatible chat completions API. */
  baseURL: string;
  /** API key, sent as `Authorization: Bearer <key>`. */
  apiKey: string;
  /** Extra per-request headers (take precedence over client defaults). */
  headers?: LLMHeaders | undefined;
  logger: Logger;
  signal?: AbortSignal | undefined;
  /** Response header carrying the served model's context length, if the API exposes one. */
  servedContextLengthHeader?: string | undefined;
  onServedModelContextLength?: ((contextLength: number) => void) | undefined;
}

/** ILLM implementation for any OpenAI-compatible chat completions API. */
export class OpenAILLM implements ILLM {
  private readonly client: OpenAI;
  private readonly headers?: LLMHeaders | undefined;
  private readonly logger: Logger;
  private readonly signal?: AbortSignal | undefined;
  private readonly servedContextLengthHeader?: string | undefined;
  private readonly onServedModelContextLength?: ((contextLength: number) => void) | undefined;

  constructor(config: OpenAILLMConfig) {
    this.client = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    });
    this.headers = config.headers;
    this.logger = config.logger;
    this.signal = config.signal;
    this.servedContextLengthHeader = config.servedContextLengthHeader;
    this.onServedModelContextLength = config.onServedModelContextLength;
  }

  private buildRequestOptions(): RequestOptions {
    return {
      headers: typeof this.headers === 'function' ? this.headers() : this.headers,
      signal: this.signal,
    };
  }

  async *create(
    body: ChatCompletionCreateParamsStreaming,
  ): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown> {
    const newMessage: Partial<RawAssistantMessageWithUsage> & Pick<RawAssistantMessageWithUsage, 'output'> = {
      output: {
        role: 'assistant',
        content: '',
      },
    };
    let response;
    let servedModelContextLengthHeader: string | null = null;

    try {
      const { data, response: httpResponse } = await this.client.chat.completions
        .create(body, this.buildRequestOptions())
        .withResponse();
      response = data;
      if (this.servedContextLengthHeader) {
        servedModelContextLengthHeader = httpResponse.headers.get(this.servedContextLengthHeader);
      }
    } catch (error) {
      if (this.signal?.aborted) {
        this.logger.debug(`LLM call aborted`, extractErrorLogFields(error));
      } else {
        this.logger.error(`Error creating chat completion`, extractErrorLogFields(error));
      }
      throw error;
    }

    for await (const event of response) {
      const chunk = toHarnessChunk(event);
      yield chunk;
      accumulateTokensFromChunk(chunk, newMessage, this.logger);
    }
    // Record after the stream drains so the last completed LLM call wins.
    const servedModelContextLength = Number(servedModelContextLengthHeader);
    if (servedModelContextLength > 0) {
      this.onServedModelContextLength?.(servedModelContextLength);
    }

    return {
      usage: newMessage.usage ?? estimateTokensForAssistantMessage(body, newMessage.output, this.logger),
      output: newMessage.output,
      finish_reason: newMessage.finish_reason ?? null,
    };
  }

  async createNonStream(body: ChatCompletionCreateParams): Promise<RawAssistantMessageWithUsage> {
    // TODO(agent): this is not really efficient. Rewrite this.
    const llmStream = this.create({ ...body, stream: true });
    let result = await llmStream.next();
    while (!result.done) {
      result = await llmStream.next();
    }

    return result.value;
  }
}

function estimateTokensForAssistantMessage(
  _request: ChatCompletionCreateParamsStreaming,
  _response: RawAssistantMessage,
  logger: Logger,
): CompletionUsage {
  // TODO(usage): fill this.
  logger.error(`Did not recieve usage from LLM, estimation is not implemented.`);
  return getEmptyUsage();
}

/**
 * Accumulates tokens from a streaming chunk into the messages buffer.
 * Handles content and tool calls accumulation for each choice in the chunk.
 * Supports thought_signature for models like gemini-3-pro-preview.
 */
function accumulateTokensFromChunk(
  chunk: ExtendedChatCompletionChunk,
  message: Partial<RawAssistantMessageWithUsage> & Pick<RawAssistantMessageWithUsage, 'output'>,
  logger: Logger,
): void {
  for (const choice of chunk.choices) {
    const delta = choice.delta;
    // Validate role only if it's explicitly present (typically only in first chunk)
    // Most chunks won't have role in delta, which is normal
    if (delta.role !== undefined && delta.role !== 'assistant') {
      logger.warn(`Unexpected role: ${delta.role}`);
      throw Error(`Unexpected role: ${delta.role}`);
    }

    if (delta.content) {
      const existing = typeof message.output.content === 'string' ? message.output.content : '';
      message.output.content = existing + delta.content;
    }
    // ToDo (handle refusal in the message, currently not handled)

    if (delta.thinking_blocks) {
      message.output.thinking_blocks ??= [];
      for (const tb of delta.thinking_blocks) {
        if (tb.type === 'thinking') {
          const blocks = message.output.thinking_blocks;
          const last = blocks[blocks.length - 1];
          // Last thinking block without signature is still in-progress — append to it.
          // Otherwise start a new block.
          let current;
          if (last?.type === 'thinking' && !last.signature) {
            current = last;
          } else {
            current = { type: 'thinking' as const, thinking: '' };
            blocks.push(current);
          }
          if (tb.thinking) {
            current.thinking += tb.thinking;
          }
          if (tb.signature) {
            current.signature = tb.signature;
          }
        } else {
          // redacted_thinking
          message.output.thinking_blocks.push(tb);
        }
      }
    }

    if (delta.tool_calls) {
      message.output.tool_calls ??= [];

      for (const toolCallDelta of delta.tool_calls) {
        const toolCallIndex = toolCallDelta.index;
        const functionDelta = toolCallDelta.function;

        // Initialize tool call if it doesn't exist
        if (!message.output.tool_calls[toolCallIndex]) {
          message.output.tool_calls[toolCallIndex] = {
            id: toolCallDelta.id ?? '',
            type: 'function',
            function: {
              name: functionDelta?.name ?? '',
              arguments: functionDelta?.arguments ?? '',
            },
            ...(toolCallDelta.provider_specific_fields && {
              provider_specific_fields: toolCallDelta.provider_specific_fields,
            }),
          };
        } else {
          const existingToolCall = message.output.tool_calls[toolCallIndex];
          if (functionDelta?.name) {
            existingToolCall.function.name = functionDelta.name;
          }
          if (functionDelta?.arguments) {
            existingToolCall.function.arguments += functionDelta.arguments;
          }
          if (toolCallDelta.id) {
            existingToolCall.id = toolCallDelta.id;
          }
          if (toolCallDelta.provider_specific_fields) {
            existingToolCall.provider_specific_fields =
              existingToolCall.provider_specific_fields ?? toolCallDelta.provider_specific_fields;
          }
        }
      }
    }
  }
  if (chunk.usage) {
    message.usage = chunk.usage;
  }
  const finishReason = chunk.choices[0]?.finish_reason;
  if (finishReason) {
    message.finish_reason = finishReason;
  }
}
