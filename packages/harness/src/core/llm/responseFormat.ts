import { z } from '@hono/zod-openapi';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat';

/**
 * Wire/runtime response format (Zod). Kept in core so AgentDefinition and AgentSpec
 * share one type without agentSession → core inversion.
 * `passthrough()` lets unknown fields within a known `type` flow through to the LLM.
 */

const ResponseFormatTextSchema = z
  .object({ type: z.literal('text') })
  .passthrough()
  .openapi('ResponseFormatText');

const ResponseFormatJsonObjectSchema = z
  .object({ type: z.literal('json_object') })
  .passthrough()
  .openapi('ResponseFormatJsonObject');

const ResponseFormatJsonSchemaSchema = z
  .object({
    type: z.literal('json_schema'),
    json_schema: z
      .object({
        name: z.string(),
        description: z.string().optional(),
        schema: z.record(z.string(), z.unknown()).optional(),
        strict: z.boolean().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough()
  .openapi('ResponseFormatJsonSchema');

export const ResponseFormatSchema = z
  .discriminatedUnion('type', [
    ResponseFormatTextSchema,
    ResponseFormatJsonObjectSchema,
    ResponseFormatJsonSchemaSchema,
  ])
  .openapi('ResponseFormat');

export type ResponseFormat = z.infer<typeof ResponseFormatSchema>;

type OpenAIResponseFormat = NonNullable<ChatCompletionCreateParamsStreaming['response_format']>;

/**
 * Maps our wire ResponseFormat into the OpenAI SDK shape for the chat.completions body.
 * Identity-preserving: spreads the validated format (and nested json_schema) so
 * Zod `.passthrough()` provider extensions reach the LLM unchanged.
 */
export function toOpenAIResponseFormat(format: ResponseFormat): OpenAIResponseFormat {
  if (format.type === 'text' || format.type === 'json_object') {
    // Spread preserves Zod .passthrough() provider extensions beyond the SDK type.
    return { ...format };
  }
  // Assert: OpenAI SDK json_schema type is a closed shape; Zod ResponseFormatSchema.passthrough()
  // intentionally forwards provider extensions (top-level and nested) for the LLM call.
  return {
    ...format,
    json_schema: { ...format.json_schema },
  } as OpenAIResponseFormat;
}
