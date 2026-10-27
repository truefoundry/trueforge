import { z } from '@hono/zod-openapi';

export const ModelParamsSchema = z
  .object({
    max_tokens: z.number().optional().describe('Maximum tokens to generate in the model response.'),
    temperature: z.number().optional().describe('Sampling temperature; higher values increase randomness.'),
    top_p: z.number().optional().describe('Nucleus sampling probability mass.'),
    top_k: z.number().optional().describe('Top-k sampling; keep only the k highest-probability tokens.'),
    parallel_tool_calls: z
      .boolean()
      .optional()
      .describe('Whether the model may emit multiple tool calls in one response.'),
    reasoning_effort: z.string().optional().describe('Provider-specific reasoning effort (e.g. low/medium/high).'),
  })
  .loose()
  .describe(
    'Model call parameters passed through to the provider. Known keys are documented; extra keys are allowed and forwarded as-is.',
  )
  .openapi('ModelParams');

export const ModelSchema = z
  .object({
    name: z
      .string()
      .min(1, 'model.name must not be empty')
      .describe('Model FQN: `provider/model`, e.g. `openai/gpt-5.2`.'),
    params: ModelParamsSchema.optional(),
  })
  .openapi('Model');

export type ModelParams = z.infer<typeof ModelParamsSchema>;
export type Model = z.infer<typeof ModelSchema>;
