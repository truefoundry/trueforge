/**
 * Model-provider domain + wire schemas: configured provider manifests (DB /
 * PUT body) and OpenAPI request/response shapes. Catalog file schemas live on
 * ModelCatalog.
 */
import { z } from '@hono/zod-openapi';
import { SUPPORTED_REASONING_EFFORTS, VERCEL_AI_PROVIDER_NAMES } from '@truefoundry/utils-core/core';
import { NameSchema, uniqueNames, type ResourceName } from './common';

/** Every type the harness has an adapter for; a test asserts each one has a schema below. */
export const ProviderTypeSchema = z.enum(VERCEL_AI_PROVIDER_NAMES).openapi('ProviderType');

export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const ReasoningEffortSchema = z.enum(SUPPORTED_REASONING_EFFORTS).openapi('ReasoningEffort');

export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const ModelPropertiesSchema = z
  .object({
    context_length: z.number().int().positive().optional(),
    max_output_tokens: z.number().int().positive().optional(),
    reasoning_efforts: z.array(ReasoningEffortSchema).min(1).optional(),
  })
  .strict()
  .openapi('ModelProperties');

export const ModelEntrySchema = z
  .object({
    model_id: z.string().min(1).describe('Upstream, provider-specific identifier sent to the provider API.'),
    name: NameSchema.describe('Internal identifier; forms the fully qualified name `name/model_name`.'),
    properties: ModelPropertiesSchema,
  })
  .strict()
  .openapi('ModelEntry');

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
    api_key: z.string().min(1),
  })
  .strict()
  .openapi('ModelProviderAuth');

const ModelProviderManifestBaseSchema = z
  .object({
    auth: ModelProviderAuthSchema,
    models: z.array(ModelEntrySchema).min(1),
  })
  .strict();

/**
 * A well-known provider has no name of its own: it is named after its type, which limits a tenant to
 * one of each because the `(tenant_id, name)` primary key replaces the row rather than adding a
 * sibling. `base_url` defaults to the adapter's endpoint and stays overridable.
 */
function wellKnownProviderManifestSchema<Type extends Exclude<ProviderType, 'custom'>>({
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

const OpenAiModelProviderManifestSchema = wellKnownProviderManifestSchema({
  type: 'openai',
  base_url: 'https://api.openai.com/v1',
}).openapi('OpenAIModelProviderManifest');

const AnthropicModelProviderManifestSchema = wellKnownProviderManifestSchema({
  type: 'anthropic',
  base_url: 'https://api.anthropic.com/v1',
}).openapi('AnthropicModelProviderManifest');

const GoogleGeminiModelProviderManifestSchema = wellKnownProviderManifestSchema({
  type: 'google-gemini',
  base_url: 'https://generativelanguage.googleapis.com/v1beta',
}).openapi('GoogleGeminiModelProviderManifest');

const FireworksModelProviderManifestSchema = wellKnownProviderManifestSchema({
  type: 'fireworks',
  base_url: 'https://api.fireworks.ai/inference/v1',
}).openapi('FireworksModelProviderManifest');

const ZaiModelProviderManifestSchema = wellKnownProviderManifestSchema({
  type: 'zai',
  base_url: 'https://api.z.ai/api/paas/v4',
}).openapi('ZaiModelProviderManifest');

const MoonshotModelProviderManifestSchema = wellKnownProviderManifestSchema({
  type: 'moonshot',
  base_url: 'https://api.moonshot.ai/v1',
}).openapi('MoonshotModelProviderManifest');

const TogetherAIModelProviderManifestSchema = wellKnownProviderManifestSchema({
  type: 'together',
  base_url: 'https://api.together.xyz/v1',
}).openapi('TogetherAIModelProviderManifest');

const AlibabaModelProviderManifestSchema = wellKnownProviderManifestSchema({
  type: 'alibaba',
  base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
}).openapi('AlibabaModelProviderManifest');

/** The one type a caller names, because only it supplies its own endpoint. */
const CustomModelProviderManifestSchema = ModelProviderManifestBaseSchema.extend({
  type: z.literal('custom'),
  name: NameSchema,
  base_url: z.url().describe("Base URL of the provider's API."),
})
  .strict()
  .openapi('CustomModelProviderManifest');

export function refineModelProviderManifest(
  manifest: { models: { model_id: string; name: string }[] },
  ctx: z.RefinementCtx,
): void {
  refineUniqueModels(manifest.models, ctx);
}

export type ModelProperties = z.infer<typeof ModelPropertiesSchema>;

/** PUT body and the persisted `model_provider.manifest` document: configuration without identity. */
export const ModelProviderManifestSchema = z
  .discriminatedUnion('type', [
    OpenAiModelProviderManifestSchema,
    AnthropicModelProviderManifestSchema,
    GoogleGeminiModelProviderManifestSchema,
    FireworksModelProviderManifestSchema,
    ZaiModelProviderManifestSchema,
    MoonshotModelProviderManifestSchema,
    TogetherAIModelProviderManifestSchema,
    AlibabaModelProviderManifestSchema,
    CustomModelProviderManifestSchema,
  ])
  .superRefine(refineModelProviderManifest)
  .openapi('ModelProviderManifest');

/** The row's key: only `custom` carries a name of its own. */
export function modelProviderName(manifest: ModelProviderManifest): ResourceName {
  return manifest.type === 'custom' ? manifest.name : manifest.type;
}

/** Configured provider as the API returns it: the row's identity beside its document. */
export const ModelProviderSchema = z
  .object({
    name: NameSchema.describe('Identity of the configured provider; first segment of a model FQN.'),
    manifest: ModelProviderManifestSchema,
  })
  .strict()
  .openapi('ModelProvider');

export const PutModelProviderRequestSchema = ModelProviderManifestSchema;

export const ListModelProvidersResponseSchema = z
  .object({
    data: z.array(ModelProviderSchema),
  })
  .openapi('ListModelProvidersResponse');

export const PutModelProviderResponseSchema = z
  .object({
    data: ModelProviderSchema,
  })
  .openapi('PutModelProviderResponse');

/** Read view: the fully qualified name resolves the provider, so no provider object is nested. */
export const ModelSchema = z
  .object({
    name: z
      .string()
      .describe('Fully qualified name `provider_name/model_name`, e.g. "openai/gpt-5-6-sol". Unique within a tenant.'),
    model_id: z.string().describe('Upstream, provider-specific identifier sent to the provider API.'),
    properties: ModelPropertiesSchema,
  })
  .strict()
  .openapi('Model');

export const ListModelsResponseSchema = z
  .object({
    data: z.array(ModelSchema),
  })
  .openapi('ListModelsResponse');

export type ModelProviderManifest = z.infer<typeof ModelProviderManifestSchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type Model = z.infer<typeof ModelSchema>;
