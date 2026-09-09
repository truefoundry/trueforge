/**
 * Model-provider domain + wire schemas: configured provider manifests (DB jsonb)
 * and OpenAPI request/response shapes. Catalog file schemas live on ModelCatalog.
 */
import { z } from '@hono/zod-openapi';
import { SUPPORTED_REASONING_EFFORTS, VERCEL_AI_PROVIDER_NAMES } from '@truefoundry/trueforge-core/core';
import { NameSchema, uniqueNames, type ResourceName } from './common';

/** Every type the harness has an adapter for; a test asserts each one has a schema below. */
export const ModelProviderTypeSchema = z.enum(VERCEL_AI_PROVIDER_NAMES).openapi('ModelProviderType');

export type ModelProviderType = z.infer<typeof ModelProviderTypeSchema>;

export const ReasoningEffortSchema = z.enum(SUPPORTED_REASONING_EFFORTS).openapi('ReasoningEffort');

export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const ModelPropertiesSchema = z
  .object({
    context_length: z.number().int().positive().optional().describe('Maximum context window size in tokens.'),
    max_output_tokens: z.number().int().positive().optional().describe('Maximum output tokens the model can generate.'),
    reasoning_efforts: z
      .array(ReasoningEffortSchema)
      .min(1)
      .optional()
      .describe('Supported reasoning-effort values for this model.'),
  })
  .strict()
  .describe('Optional model capability metadata.')
  .openapi('ModelProperties');

export const ConfiguredModelSchema = z
  .object({
    model_id: z.string().min(1).describe('Upstream, provider-specific identifier sent to the provider API.'),
    name: NameSchema,
    properties: ModelPropertiesSchema,
  })
  .strict()
  .openapi('ConfiguredModel');

/** Adds issues when two models share a `model_id` or a `name`. */
export function refineUniqueModels(models: { model_id: string; name: string }[], ctx: z.RefinementCtx): void {
  uniqueNames(models, ctx);
  const seenModelIds = new Set<string>();
  for (const model of models) {
    if (seenModelIds.has(model.model_id)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate model_id "${model.model_id}" — model_ids must be unique within a provider`,
        path: ['models'],
      });
    }
    seenModelIds.add(model.model_id);
  }
}

const ModelProviderAuthSchema = z
  .object({
    api_key: z
      .string()
      .min(1)
      .describe(
        'Provider API key. Responses are redacted; on PUT, a real value sets/rotates and a redacted value keeps the stored key.',
      ),
  })
  .strict()
  .describe('Provider authentication credentials.')
  .openapi('ModelProviderAuth');

const ModelProviderManifestBaseSchema = z
  .object({
    auth: ModelProviderAuthSchema,
    models: z.array(ConfiguredModelSchema).min(1).describe('Models exposed by this provider (at least one).'),
  })
  .strict();

/**
 * A well-known provider has no name of its own: it is named after its type, which limits a tenant to
 * one of each because the `(tenant_id, name)` primary key replaces the row rather than adding a
 * sibling. `base_url` defaults to the adapter's endpoint and stays overridable.
 */
function wellKnownProviderSchema<Type extends Exclude<ModelProviderType, 'custom' | 'truefoundry'>>({
  type,
  base_url,
}: {
  type: Type;
  base_url: string;
}) {
  return ModelProviderManifestBaseSchema.extend({
    type: z.literal(type),
    base_url: z.url().default(base_url).describe("Override of the provider's default API base URL."),
  }).strict();
}

const OpenAiModelProviderSchema = wellKnownProviderSchema({
  type: 'openai',
  base_url: 'https://api.openai.com/v1',
}).openapi('OpenAIModelProvider');

const AnthropicModelProviderSchema = wellKnownProviderSchema({
  type: 'anthropic',
  base_url: 'https://api.anthropic.com/v1',
}).openapi('AnthropicModelProvider');

const GoogleGeminiModelProviderSchema = wellKnownProviderSchema({
  type: 'google-gemini',
  base_url: 'https://generativelanguage.googleapis.com/v1beta',
}).openapi('GoogleGeminiModelProvider');

const FireworksModelProviderSchema = wellKnownProviderSchema({
  type: 'fireworks',
  base_url: 'https://api.fireworks.ai/inference/v1',
}).openapi('FireworksModelProvider');

const ZaiModelProviderSchema = wellKnownProviderSchema({
  type: 'zai',
  base_url: 'https://api.z.ai/api/paas/v4',
}).openapi('ZaiModelProvider');

const MoonshotModelProviderSchema = wellKnownProviderSchema({
  type: 'moonshot',
  base_url: 'https://api.moonshot.ai/v1',
}).openapi('MoonshotModelProvider');

const TogetherAIModelProviderSchema = wellKnownProviderSchema({
  type: 'together',
  base_url: 'https://api.together.xyz/v1',
}).openapi('TogetherAIModelProvider');

const AlibabaModelProviderSchema = wellKnownProviderSchema({
  type: 'alibaba',
  base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
}).openapi('AlibabaModelProvider');

/**
 * Managed by TrueFoundry: modelled like `custom` (its own `base_url` + `auth`), but unnamed like a
 * well-known type. The gateway endpoint and passthrough token are populated by the store at runtime;
 * `auth` is stripped from API responses.
 */
const TrueFoundryModelProviderSchema = ModelProviderManifestBaseSchema.extend({
  type: z.literal('truefoundry'),
  base_url: z.url().describe('Base URL of the TrueFoundry AI gateway the models are invoked against.'),
  auth: ModelProviderAuthSchema.optional(),
})
  .strict()
  .openapi('TrueFoundryModelProvider');

/** The one type a caller names, because only it supplies its own endpoint. */
const CustomModelProviderSchema = ModelProviderManifestBaseSchema.extend({
  type: z.literal('custom'),
  name: NameSchema,
  base_url: z.url().describe("Base URL of the provider's API."),
  auth: ModelProviderAuthSchema.optional(),
})
  .strict()
  .openapi('CustomModelProvider');

export function refineModelProviderManifest(
  manifest: { models: { model_id: string; name: string }[] },
  ctx: z.RefinementCtx,
): void {
  refineUniqueModels(manifest.models, ctx);
}

export type ModelProperties = z.infer<typeof ModelPropertiesSchema>;

/**
 * Configured provider jsonb (`model_provider.manifest`). Only `custom` carries a name, so the
 * row's key column comes from `modelProviderName` rather than from a field every type repeats.
 */
const ModelProviderBodySchema = z
  .discriminatedUnion('type', [
    OpenAiModelProviderSchema,
    AnthropicModelProviderSchema,
    GoogleGeminiModelProviderSchema,
    FireworksModelProviderSchema,
    ZaiModelProviderSchema,
    MoonshotModelProviderSchema,
    TogetherAIModelProviderSchema,
    AlibabaModelProviderSchema,
    TrueFoundryModelProviderSchema,
    CustomModelProviderSchema,
  ])
  .superRefine(refineModelProviderManifest);

export const ModelProviderManifestSchema = ModelProviderBodySchema.openapi('ModelProviderManifest');

/** The row's key: only `custom` carries a name of its own. */
export function modelProviderName(provider: ModelProviderManifest): ResourceName {
  return provider.type === 'custom' ? provider.name : provider.type;
}

/** Settings wire item: identity column plus nested manifest. */
export const ConfiguredModelProviderSchema = z
  .object({
    name: NameSchema,
    manifest: ModelProviderManifestSchema,
  })
  .strict()
  .openapi('ConfiguredModelProvider');

export const CreateModelProviderRequestSchema = z
  .object({
    manifest: ModelProviderManifestSchema,
  })
  .strict()
  .openapi('CreateModelProviderRequest');

export const UpdateModelProviderRequestSchema = z
  .object({
    manifest: ModelProviderManifestSchema,
  })
  .strict()
  .openapi('UpdateModelProviderRequest');

export const GetModelProviderResponseSchema = z
  .object({
    data: ConfiguredModelProviderSchema,
  })
  .openapi('GetModelProviderResponse');

export const ListModelProvidersResponseSchema = z
  .object({
    data: z.array(ConfiguredModelProviderSchema),
  })
  .openapi('ListModelProvidersResponse');

/** Provider identity on the models list read view. */
export const AvailableModelProviderSchema = z
  .object({
    name: z.string().min(1).describe('Configured provider resource name; matches the FQN prefix of `name`.'),
  })
  .strict()
  .describe('Owning configured provider.')
  .openapi('AvailableModelProvider');

/** Read view over configured providers: FQN plus explicit provider identity for clients. */
export const AvailableModelSchema = z
  .object({
    name: z
      .string()
      .describe('Fully qualified name `provider_name/model_name`, e.g. "openai/gpt-5-6-sol". Unique within a tenant.'),
    model_id: z.string().describe('Upstream, provider-specific identifier sent to the provider API.'),
    provider: AvailableModelProviderSchema,
    properties: ModelPropertiesSchema,
  })
  .strict()
  .openapi('AvailableModel');

export const ListAvailableModelsResponseSchema = z
  .object({
    data: z.array(AvailableModelSchema),
  })
  .openapi('ListAvailableModelsResponse');

export type ModelProviderManifest = z.infer<typeof ModelProviderManifestSchema>;
export type ConfiguredModelProvider = z.infer<typeof ConfiguredModelProviderSchema>;
export type CreateModelProviderRequest = z.infer<typeof CreateModelProviderRequestSchema>;
export type UpdateModelProviderRequest = z.infer<typeof UpdateModelProviderRequestSchema>;
export type AvailableModelProvider = z.infer<typeof AvailableModelProviderSchema>;
export type AvailableModel = z.infer<typeof AvailableModelSchema>;
