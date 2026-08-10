import { z } from '@hono/zod-openapi';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat';

/**
 * Wire/runtime response format (Zod). Kept in core so AgentDefinition and AgentSpec
 * share one type without agentSession → core inversion.
 * `.loose()` lets unknown fields within a known `type` flow through to the LLM.
 */

const ResponseFormatTextSchema = z
  .object({ type: z.literal('text').describe('Unconstrained text output.') })
  .loose()
  .describe('Default text response format. Extra provider fields are allowed.')
  .openapi('ResponseFormatText');
const ResponseFormatJsonObjectSchema = z
  .object({ type: z.literal('json_object').describe('Model must return a JSON object.') })
  .loose()
  .describe('JSON object response format. Extra provider fields are allowed.')
  .openapi('ResponseFormatJsonObject');
const ResponseFormatJsonSchemaSchema = z
  .object({
    type: z.literal('json_schema').describe('Model must return JSON matching a schema.'),
    json_schema: z
      .object({
        name: z.string().describe('Schema name sent to the provider.'),
        description: z.string().optional().describe('Optional schema description for the model.'),
        schema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema object for the response.'),
        strict: z
          .boolean()
          .nullable()
          .optional()
          .describe('When true, ask the provider to enforce the schema strictly.'),
      })
      .loose()
      .describe('JSON Schema payload. Extra provider fields are allowed.'),
  })
  .loose()
  .describe('JSON Schema response format. Extra provider fields are allowed.')
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
 * Zod `.loose()` provider extensions reach the LLM unchanged.
 */
export function toOpenAIResponseFormat(format: ResponseFormat): OpenAIResponseFormat {
  if (format.type === 'text' || format.type === 'json_object') {
    // Spread preserves Zod .loose() provider extensions beyond the SDK type.
    return { ...format };
  }
  // Assert: OpenAI SDK json_schema type is a closed shape; Zod ResponseFormatSchema.loose()
  // intentionally forwards provider extensions (top-level and nested) for the LLM call.
  return {
    ...format,
    json_schema: { ...format.json_schema },
  } as OpenAIResponseFormat;
}
