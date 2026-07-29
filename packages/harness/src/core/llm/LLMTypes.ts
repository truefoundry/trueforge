// TODO(agent): We should not maintain choices anymore.
// https://platform.claude.com/docs/en/api/messages/create
// https://platform.openai.com/docs/api-reference/responses/object#responses-object-output
// Check the above page and check code to and come up with a streaming structure that does not expose
// choices to upstream.

// TODO(agent): At this point, we can write the types from scratch. No point in keeping the old OpenAI baggage.
import { z } from '@hono/zod-openapi';
import type { ChatCompletionChunk } from 'openai/resources/chat';
import {
  ChatCompletionAssistantMessageParamSchema,
  ChatCompletionChunkDeltaSchema,
  ChatCompletionChunkDeltaToolCallSchema,
  ChatCompletionChunkFinishReasonSchema,
  ChatCompletionMessageToolCallSchema,
  ChatCompletionToolMessageParamSchema,
  ChatCompletionUserMessageParamSchema,
} from './openaiSchemas';

export const ThinkingBlockSchema = z
  .object({
    type: z.literal('thinking'),
    thinking: z.string(),
    signature: z.string().optional(),
  })
  .openapi('ThinkingBlock');

export const RedactedThinkingBlockSchema = z
  .object({
    type: z.literal('redacted_thinking'),
    data: z.string(),
  })
  .openapi('RedactedThinkingBlock');

export const ThinkingBlockUnionSchema = z.union([ThinkingBlockSchema, RedactedThinkingBlockSchema]);

export const InternalToolCallInfoSchema = z.object({
  type: z.enum(['truefoundry-system', 'mcp']),
  mcp_server_id: z.string(),
  mcp_server_name: z.string(),
  original_tool_name: z.string(),
  is_approval_required: z.boolean().optional(),
  is_deferred: z.boolean().optional(),
  is_client_side: z.boolean().optional(),
  // Runtime + wire: deviation from origin/main OpenAPI (which omitted this field) is accepted.
  is_thread_creation: z.boolean().optional(),
});

export const TrueFoundrySystemToolInfoSchema = z
  .object({
    type: z.literal('truefoundry-system'),
    name: z.string(),
  })
  .openapi('TrueFoundrySystemToolInfo');

export const MCPToolInfoSchema = z
  .object({
    type: z.literal('mcp'),
    server_id: z.string(),
    server_name: z.string(),
    name: z.string(),
  })
  .openapi('MCPToolInfo');

export const RawToolCallSchema = ChatCompletionMessageToolCallSchema.extend({
  provider_specific_fields: z.record(z.string(), z.unknown()).optional(),
}).openapi('RawToolCall');

export const InternalEnrichedToolCallSchema = RawToolCallSchema.extend({
  tool_info: InternalToolCallInfoSchema,
});

export const ToolInfoSchema = z
  .discriminatedUnion('type', [TrueFoundrySystemToolInfoSchema, MCPToolInfoSchema])
  .openapi('ToolInfo');

export const EnrichedToolCallSchema = RawToolCallSchema.extend({
  tool_info: ToolInfoSchema,
}).openapi('ToolCall');

export const RawAssistantMessageSchema = ChatCompletionAssistantMessageParamSchema.omit({
  tool_calls: true,
  audio: true,
  function_call: true,
})
  .extend({
    tool_calls: z.array(RawToolCallSchema).optional(),
    thinking_blocks: z.array(ThinkingBlockUnionSchema).optional(),
    /** Plain-text thinking content streamed incrementally for frontend display; redundant with thinking_blocks[].thinking. */
    reasoning_content: z.string().optional(),
  })
  .openapi('RawAssistantMessage');

export const InternalEnrichedAssistantMessageSchema = RawAssistantMessageSchema.omit({
  tool_calls: true,
}).extend({
  tool_calls: z.array(InternalEnrichedToolCallSchema).optional(),
});

// `thinking_blocks` omitted: kept on the internal message for Redis replay, hidden from the client event.
export const EnrichedAssistantMessageSchema = RawAssistantMessageSchema.omit({
  tool_calls: true,
  thinking_blocks: true,
})
  .extend({
    tool_calls: z.array(EnrichedToolCallSchema).optional(),
  })
  .openapi('EnrichedAssistantMessage');

export const ExtendedChunkDeltaToolCallSchema = ChatCompletionChunkDeltaToolCallSchema.extend({
  tool_info: ToolInfoSchema.optional(),
  provider_specific_fields: z.record(z.string(), z.unknown()).optional(),
}).openapi('ExtendedChunkDeltaToolCall');

export const ExtendedChunkDeltaSchema = ChatCompletionChunkDeltaSchema.omit({ tool_calls: true })
  .extend({
    tool_calls: z.array(ExtendedChunkDeltaToolCallSchema).optional(),
    /** Structured thinking blocks from the gateway; accumulated into complete blocks (with signatures) for multi-turn replay. */
    thinking_blocks: z.array(ThinkingBlockUnionSchema).optional(),
    /** Plain-text thinking content streamed incrementally for frontend display; not stored — redundant with thinking_blocks[].thinking. */
    reasoning_content: z.string().optional(),
  })
  .openapi('ExtendedChunkDelta');

export const LLMUserMessageSchema = ChatCompletionUserMessageParamSchema.pick({
  role: true,
  content: true,
}).openapi('LLMUserMessage');

export const LLMToolMessageSchema = ChatCompletionToolMessageParamSchema.omit({ content: true })
  .extend({
    // TODO(agent): Where do I update the Zod code for this change?
    content: z.string(),
  })
  .openapi('LLMToolMessage');

/** Raw usage accepted from the OpenAI-compatible gateway response. */
export const GatewayChatCompletionUsageSchema = z
  .object({
    completion_tokens: z.number().int().nonnegative(),
    prompt_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    completion_tokens_details: z
      .object({
        reasoning_tokens: z.number().int().nonnegative().optional(),
      })
      .optional(),
    prompt_tokens_details: z
      .object({
        cached_tokens: z.number().int().nonnegative().optional(),
      })
      .optional(),
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
    cache_creation_input_tokens: z.number().int().nonnegative().optional(),
    costInUSD: z.number().nonnegative().optional(),
  })
  .openapi('GatewayChatCompletionUsage');

/**
 * Provider-agnostic usage used throughout the harness after gateway normalization.
 * Keep to fields consumers need today; add more optional fields when needed.
 */
export const CompletionUsageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    cache_read_tokens: z.number().int().nonnegative().optional(),
    cache_write_tokens: z.number().int().nonnegative().optional(),
    cost_in_USD: z.number().nonnegative().optional(),
  })
  .openapi('CompletionUsage');

export const FinishReasonSchema = ChatCompletionChunkFinishReasonSchema.openapi('FinishReason');

export type ThinkingBlock = z.infer<typeof ThinkingBlockSchema>;
export type RedactedThinkingBlock = z.infer<typeof RedactedThinkingBlockSchema>;
export type InternalToolCallInfo = z.infer<typeof InternalToolCallInfoSchema>;
export type TrueFoundrySystemToolInfo = z.infer<typeof TrueFoundrySystemToolInfoSchema>;
export type MCPToolInfo = z.infer<typeof MCPToolInfoSchema>;
export type ToolInfo = z.infer<typeof ToolInfoSchema>;
export type InternalEnrichedToolCall = z.infer<typeof InternalEnrichedToolCallSchema>;
export type EnrichedToolCall = z.infer<typeof EnrichedToolCallSchema>;
export type RawAssistantMessage = z.infer<typeof RawAssistantMessageSchema>;
export type InternalEnrichedAssistantMessage = z.infer<typeof InternalEnrichedAssistantMessageSchema>;
export type EnrichedAssistantMessage = z.infer<typeof EnrichedAssistantMessageSchema>;
export type ExtendedDeltaToolCall = z.infer<typeof ExtendedChunkDeltaToolCallSchema>;
export type ExtendedDelta = z.infer<typeof ExtendedChunkDeltaSchema>;
export type LLMUserMessage = z.infer<typeof LLMUserMessageSchema>;
export type LLMToolMessage = z.infer<typeof LLMToolMessageSchema>;
export type GatewayChatCompletionUsage = z.infer<typeof GatewayChatCompletionUsageSchema>;
export type CompletionUsage = z.infer<typeof CompletionUsageSchema>;
export type FinishReason = z.infer<typeof FinishReasonSchema>;

export function getEmptyUsage(): CompletionUsage {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_in_USD: 0,
  };
}

/**
 * Extended choice type that includes thought_signature in the delta.
 */
interface ExtendedChoice extends Omit<ChatCompletionChunk.Choice, 'delta'> {
  /**
   * A chat completion delta generated by streamed model responses, with thought_signature support.
   */
  delta: ExtendedDelta;
}

/**
 * Extended chat completion chunk that includes thought_signature in tool calls.
 * `usage` is the raw gateway payload; consumers normalize with `normalizeUsage` / `mergeUsage`.
 */
export interface ExtendedChatCompletionChunk extends Omit<ChatCompletionChunk, 'choices' | 'usage'> {
  /**
   * A list of chat completion choices, with thought_signature support in deltas.
   */
  choices: ExtendedChoice[];
  usage?: GatewayChatCompletionUsage | null;
}

export interface RawAssistantMessageWithUsage {
  output: RawAssistantMessage;
  usage: GatewayChatCompletionUsage;
  finish_reason: FinishReason;
}

export const UNKNOWN_TOOL_NAME = 'unknown';
