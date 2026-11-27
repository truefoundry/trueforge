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

/** A model FQN and the call parameters used with it. */
export const ModelSchema = z
  .object({
    name: z
      .string()
      .min(1, 'model.name must not be empty')
      .describe('Model FQN: `provider/model`, e.g. `openai/gpt-5.2`.'),
    params: ModelParamsSchema.optional(),
  })
  .openapi('Model');

export const FixedModelSchema = z
  .object({
    type: z
      .literal('fixed')
      .default('fixed')
      .describe('Run every turn on the model named in `name`. Omitted by older clients.'),
    ...ModelSchema.shape,
  })
  .strict()
  .openapi('FixedModel');

/** Fewest models an auto spec may name, so every routing category can have one. */
export const MIN_AUTO_CANDIDATE_MODELS = 4;

export const MAX_AUTO_CANDIDATE_MODELS = 10;

/** Split `provider/model` FQN. Returns undefined when the shape is not exactly one slash. */
export function parseModelFqn(name: string): { providerName: string; modelName: string } | undefined {
  const slash = name.indexOf('/');
  if (slash <= 0 || slash === name.length - 1) {
    return undefined;
  }
  if (name.includes('/', slash + 1)) {
    return undefined;
  }
  return { providerName: name.slice(0, slash), modelName: name.slice(slash + 1) };
}

/** The `type` of a spec model that routes each turn among its candidate models. */
export const AUTO_MODEL = 'auto';

export const AutoModelSchema = z
  .object({
    type: z.literal(AUTO_MODEL).describe('Route each turn to the cheapest candidate model that suits the task.'),
    candidate_models: z
      .array(z.string().refine(name => parseModelFqn(name) !== undefined, 'Use the full model name, account/model.'))
      .max(
        MAX_AUTO_CANDIDATE_MODELS,
        `model.candidate_models takes at most ${String(MAX_AUTO_CANDIDATE_MODELS)} models`,
      )
      .refine(names => names.length === 0 || names.length >= MIN_AUTO_CANDIDATE_MODELS, {
        message: `model.candidate_models needs at least ${String(MIN_AUTO_CANDIDATE_MODELS)} models`,
      })
      .refine(names => new Set(names).size === names.length, {
        message: 'model.candidate_models must not contain duplicates',
      })
      .describe(
        `Full names (account/model) of ${String(MIN_AUTO_CANDIDATE_MODELS)} to ${String(MAX_AUTO_CANDIDATE_MODELS)} models the router may choose from.`,
      ),
  })
  .strict()
  .openapi('AutoModel');

export const ModelDefinitionSchema = z.union([FixedModelSchema, AutoModelSchema]).openapi('ModelDefinition');

export type ModelParams = z.infer<typeof ModelParamsSchema>;
export type Model = z.infer<typeof ModelSchema>;
export type FixedModel = z.infer<typeof FixedModelSchema>;
export type AutoModel = z.infer<typeof AutoModelSchema>;
export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>;

/** Every model FQN the spec may run a turn on: the fixed model, or all auto candidates. */
export function modelNames(model: ModelDefinition): readonly string[] {
  return model.type === 'fixed' ? [model.name] : model.candidate_models;
}
