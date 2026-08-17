/**
 * Canonical OpenAI wire schemas with OpenAPI component names.
 * Nested composites are rebuilt from decorated leaves so `$ref`s are preserved.
 */
import { z } from '@hono/zod-openapi';

export const ChatCompletionContentPartTextSchema = z
  .object({
    type: z.literal('text').describe('Text content part.'),
    text: z.string().describe('Plain-text content.'),
  })
  .openapi('ChatCompletionContentPartText');

export const ChatCompletionContentPartRefusalSchema = z
  .object({
    type: z.literal('refusal').describe('Model refusal content part.'),
    refusal: z.string().describe('Refusal message text.'),
  })
  .openapi('ChatCompletionContentPartRefusal');

export const ChatCompletionContentPartImageSchema = z
  .object({
    type: z.literal('image_url').describe('Image URL content part.'),
    image_url: z.object({
      url: z.string().describe('Image URL or data URI.'),
      detail: z.enum(['auto', 'low', 'high']).optional().describe('Optional image detail level.'),
    }),
  })
  .openapi('ChatCompletionContentPartImage');

export const ChatCompletionContentPartInputAudioSchema = z
  .object({
    type: z.literal('input_audio').describe('Input audio content part.'),
    input_audio: z.object({
      data: z.string().describe('Base64-encoded audio data.'),
      format: z.enum(['wav', 'mp3']).describe('Audio encoding format.'),
    }),
  })
  .openapi('ChatCompletionContentPartInputAudio');

export const ChatCompletionContentPartFileSchema = z
  .object({
    type: z.literal('file').describe('File content part.'),
    file: z.object({
      file_data: z.string().optional().describe('Optional base64 file payload.'),
      file_id: z.string().optional().describe('Optional provider file id.'),
      filename: z.string().optional().describe('Optional filename.'),
    }),
  })
  .openapi('ChatCompletionContentPartFile');

// User-message content parts (matches OpenAI's `ChatCompletionContentPart`).
export const ChatCompletionContentPartSchema = z.union([
  ChatCompletionContentPartTextSchema,
  ChatCompletionContentPartImageSchema,
  ChatCompletionContentPartInputAudioSchema,
  ChatCompletionContentPartFileSchema,
]);

export const ChatCompletionMessageToolCallSchema = z
  .object({
    id: z.string().describe('Tool call id.'),
    type: z.literal('function').describe('Tool call type.'),
    function: z.object({
      name: z.string().describe('Function/tool name.'),
      arguments: z.string().describe('JSON-encoded function arguments string.'),
    }),
  })
  .openapi('ChatCompletionMessageToolCall');

export const ChatCompletionChunkDeltaToolCallSchema = z
  .object({
    index: z.number().int().nonnegative().describe('Index of this tool call in the streaming delta array.'),
    id: z.string().optional().describe('Tool call id (may arrive across multiple deltas).'),
    type: z.literal('function').optional().describe('Tool call type when present on this delta.'),
    function: z
      .object({
        name: z.string().optional().describe('Partial or complete function name.'),
        arguments: z.string().optional().describe('Partial or complete JSON arguments string.'),
      })
      .optional(),
  })
  .openapi('ChatCompletionChunkDeltaToolCall');

export const ChatCompletionChunkDeltaSchema = z
  .object({
    content: z.string().nullable().optional().describe('Incremental assistant text content.'),
    refusal: z.string().nullable().optional().describe('Incremental refusal text when present.'),
    role: z
      .enum(['developer', 'system', 'user', 'assistant', 'tool'])
      .optional()
      .describe('Role when set on the delta.'),
    function_call: z
      .object({
        name: z.string().optional().describe('Legacy function-call name fragment.'),
        arguments: z.string().optional().describe('Legacy function-call arguments fragment.'),
      })
      .optional(),
    tool_calls: z.array(ChatCompletionChunkDeltaToolCallSchema).optional().describe('Incremental tool-call deltas.'),
  })
  .openapi('ChatCompletionChunkDelta');

export const ChatCompletionAssistantMessageParamSchema = z
  .object({
    role: z.literal('assistant').describe('Assistant message role.'),
    audio: z
      .object({ id: z.string().describe('Provider audio id.') })
      .nullable()
      .optional(),
    content: z
      .union([
        z.string(),
        z.array(z.union([ChatCompletionContentPartTextSchema, ChatCompletionContentPartRefusalSchema])),
      ])
      .nullable()
      .optional()
      .describe('Assistant message content as text or content parts.'),
    function_call: z
      .object({
        name: z.string().describe('Legacy function name.'),
        arguments: z.string().describe('Legacy function arguments JSON string.'),
      })
      .nullable()
      .optional(),
    name: z.string().optional().describe('Optional participant name.'),
    refusal: z.string().nullable().optional().describe('Optional refusal text.'),
    tool_calls: z
      .array(ChatCompletionMessageToolCallSchema)
      .optional()
      .describe('Tool calls requested by the assistant.'),
  })
  .openapi('ChatCompletionAssistantMessageParam');

// `content` is wider here than in our pipeline; `LLMToolMessageSchema` narrows it to string.
export const ChatCompletionToolMessageParamSchema = z
  .object({
    role: z.literal('tool').describe('Tool message role.'),
    tool_call_id: z.string().describe('Id of the tool call this message responds to.'),
    content: z.union([z.string(), z.array(ChatCompletionContentPartTextSchema)]).describe('Tool result content.'),
  })
  .openapi('ChatCompletionToolMessageParam');

export const ChatCompletionUserMessageParamSchema = z
  .object({
    role: z.literal('user').describe('User message role.'),
    content: z
      .union([z.string(), z.array(ChatCompletionContentPartSchema)])
      .describe('User message content as text or content parts.'),
    name: z.string().optional().describe('Optional participant name.'),
  })
  .openapi('ChatCompletionUserMessageParam');

export const ChatCompletionChunkFinishReasonSchema = z
  .enum(['stop', 'length', 'tool_calls', 'content_filter', 'function_call'])
  .describe('Why the model stopped generating.')
  .openapi('ChatCompletionChunkFinishReason');
