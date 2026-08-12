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
    type: z.literal('thinking').describe('Structured thinking block.'),
    thinking: z.string().describe('Thinking text content.'),
    signature: z.string().optional().describe('Optional provider signature for multi-turn replay.'),
  })
  .openapi('ThinkingBlock');

export const RedactedThinkingBlockSchema = z
  .object({
    type: z.literal('redacted_thinking').describe('Redacted thinking block.'),
    data: z.string().describe('Opaque redacted thinking payload from the provider.'),
  })
  .openapi('RedactedThinkingBlock');

export const ThinkingBlockUnionSchema = z.union([ThinkingBlockSchema, RedactedThinkingBlockSchema]);

export const InternalToolCallInfoSchema = z.object({
  type: z.enum(['truefoundry-system', 'mcp']).describe('Whether the tool is a system tool or MCP tool.'),
  mcp_server_id: z.string().describe('Internal MCP server id (empty for system tools).'),
  mcp_server_name: z.string().describe('Configured MCP server name (empty for system tools).'),
  original_tool_name: z.string().describe('Original tool name before any remapping.'),
  is_approval_required: z.boolean().optional().describe('Whether this tool call requires human approval.'),
  is_deferred: z.boolean().optional().describe('Whether the tool was loaded via deferred discovery.'),
  is_client_side: z.boolean().optional().describe('Whether the client must supply the tool result.'),
  // Runtime + wire: deviation from origin/main OpenAPI (which omitted this field) is accepted.
  is_thread_creation: z.boolean().optional().describe('Whether this tool call creates a subagent thread.'),
});

export const TrueFoundrySystemToolInfoSchema = z
  .object({
    type: z.literal('truefoundry-system').describe('Built-in harness system tool.'),
    name: z.string().describe('System tool name.'),
  })
  .openapi('TrueFoundrySystemToolInfo');

export const MCPToolInfoSchema = z
  .object({
    type: z.literal('mcp').describe('Tool hosted on an MCP server.'),
    server_id: z.string().describe('Internal MCP server id.'),
    server_name: z.string().describe('Configured MCP server name.'),
    name: z.string().describe('Tool name on the MCP server.'),
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
    /** Source of the message: which provider/model sent it (`provider_type/provider_name/model_name`). */
    source: z.string().optional(),
  })
  .openapi('RawAssistantMessage');

export const InternalEnrichedAssistantMessageSchema = RawAssistantMessageSchema.omit({
  tool_calls: true,
}).extend({
  tool_calls: z.array(InternalEnrichedToolCallSchema).optional(),
});

// `thinking_blocks` / `source` omitted: kept on the internal message for context replay, hidden from the client event.
export const EnrichedAssistantMessageSchema = RawAssistantMessageSchema.omit({
  tool_calls: true,
  thinking_blocks: true,
  source: true,
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

export const CompletionUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().describe('Input tokens for this completion.'),
    output_tokens: z.number().int().nonnegative().describe('Output tokens for this completion.'),
    total_tokens: z.number().int().nonnegative().describe('Total tokens (input + output).'),
    cache_read_tokens: z.number().int().nonnegative().optional().describe('Optional cache-read tokens.'),
    cache_write_tokens: z.number().int().nonnegative().optional().describe('Optional cache-write tokens.'),
    reasoning_tokens: z.number().int().nonnegative().optional().describe('Optional reasoning tokens.'),
    cost_in_usd: z.number().nonnegative().optional().describe('Optional estimated cost in USD.'),
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
export type CompletionUsage = z.infer<typeof CompletionUsageSchema>;
export type FinishReason = z.infer<typeof FinishReasonSchema>;

export function getEmptyUsage(): CompletionUsage {
  return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
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
 * `usage` is harness-normalized; the LLM adapter maps the wire `usage` payload at the adapter boundary.
 */
export interface ExtendedChatCompletionChunk extends Omit<ChatCompletionChunk, 'choices' | 'usage'> {
  /**
   * A list of chat completion choices, with thought_signature support in deltas.
   */
  choices: ExtendedChoice[];
  usage?: CompletionUsage | null;
}

export interface RawAssistantMessageWithUsage {
  output: RawAssistantMessage;
  usage: CompletionUsage;
  /** null when the stream ended without a finish_reason chunk (e.g. provider omitted it). */
  finish_reason: FinishReason | null;
}

export const UNKNOWN_TOOL_NAME = 'unknown';
