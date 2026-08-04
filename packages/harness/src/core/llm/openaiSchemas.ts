/**
 * Canonical OpenAI wire schemas with OpenAPI component names.
 * Nested composites are rebuilt from decorated leaves so `$ref`s are preserved.
 */
import { z } from '@hono/zod-openapi';

export const ChatCompletionContentPartTextSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
  })
  .openapi('ChatCompletionContentPartText');

export const ChatCompletionContentPartRefusalSchema = z
  .object({
    type: z.literal('refusal'),
    refusal: z.string(),
  })
  .openapi('ChatCompletionContentPartRefusal');

export const ChatCompletionContentPartImageSchema = z
  .object({
    type: z.literal('image_url'),
    image_url: z.object({
      url: z.string(),
      detail: z.enum(['auto', 'low', 'high']).optional(),
    }),
  })
  .openapi('ChatCompletionContentPartImage');

export const ChatCompletionContentPartInputAudioSchema = z
  .object({
    type: z.literal('input_audio'),
    input_audio: z.object({
      data: z.string(),
      format: z.enum(['wav', 'mp3']),
    }),
  })
  .openapi('ChatCompletionContentPartInputAudio');

export const ChatCompletionContentPartFileSchema = z
  .object({
    type: z.literal('file'),
    file: z.object({
      file_data: z.string().optional(),
      file_id: z.string().optional(),
      filename: z.string().optional(),
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
    id: z.string(),
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      arguments: z.string(),
    }),
  })
  .openapi('ChatCompletionMessageToolCall');

export const ChatCompletionChunkDeltaToolCallSchema = z
  .object({
    index: z.number().int().nonnegative(),
    id: z.string().optional(),
    type: z.literal('function').optional(),
    function: z
      .object({
        name: z.string().optional(),
        arguments: z.string().optional(),
      })
      .optional(),
  })
  .openapi('ChatCompletionChunkDeltaToolCall');

export const ChatCompletionChunkDeltaSchema = z
  .object({
    content: z.string().nullable().optional(),
    refusal: z.string().nullable().optional(),
    role: z.enum(['developer', 'system', 'user', 'assistant', 'tool']).optional(),
    function_call: z
      .object({
        name: z.string().optional(),
        arguments: z.string().optional(),
      })
      .optional(),
    tool_calls: z.array(ChatCompletionChunkDeltaToolCallSchema).optional(),
  })
  .openapi('ChatCompletionChunkDelta');

export const ChatCompletionAssistantMessageParamSchema = z
  .object({
    role: z.literal('assistant'),
    audio: z.object({ id: z.string() }).nullable().optional(),
    content: z
      .union([
        z.string(),
        z.array(z.union([ChatCompletionContentPartTextSchema, ChatCompletionContentPartRefusalSchema])),
      ])
      .nullable()
      .optional(),
    function_call: z
      .object({
        name: z.string(),
        arguments: z.string(),
      })
      .nullable()
      .optional(),
    name: z.string().optional(),
    refusal: z.string().nullable().optional(),
    tool_calls: z.array(ChatCompletionMessageToolCallSchema).optional(),
  })
  .openapi('ChatCompletionAssistantMessageParam');

// `content` is wider here than in our pipeline; `LLMToolMessageSchema` narrows it to string.
export const ChatCompletionToolMessageParamSchema = z
  .object({
    role: z.literal('tool'),
    tool_call_id: z.string(),
    content: z.union([z.string(), z.array(ChatCompletionContentPartTextSchema)]),
  })
  .openapi('ChatCompletionToolMessageParam');

export const ChatCompletionUserMessageParamSchema = z
  .object({
    role: z.literal('user'),
    content: z.union([z.string(), z.array(ChatCompletionContentPartSchema)]),
    name: z.string().optional(),
  })
  .openapi('ChatCompletionUserMessageParam');

export const ChatCompletionChunkFinishReasonSchema = z
  .enum(['stop', 'length', 'tool_calls', 'content_filter', 'function_call'])
  .openapi('ChatCompletionChunkFinishReason');
