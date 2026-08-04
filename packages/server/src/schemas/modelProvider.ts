/**
 * Model-provider domain + wire schemas: configured provider manifests (DB /
 * PUT body) and OpenAPI request/response shapes. Catalog file schemas live on
 * ModelCatalog.
 */
import { z } from '@hono/zod-openapi';
import { NameSchema, uniqueNames } from './common';

export const ProviderTypeSchema = z.enum(['openai', 'anthropic', 'custom']).openapi('ProviderType');

export const ModelPropertiesSchema = z
  .object({
    context_length: z.number().int().positive(),
    max_output_tokens: z.number().int().positive(),
    reasoning_efforts: z.array(z.string().min(1)).min(1).optional(),
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
        code: z.ZodIssueCode.custom,
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

/** Shared by openai/anthropic: optional override of the provider's default endpoint. */
const WellKnownModelProviderManifestBaseSchema = ModelProviderManifestBaseSchema.extend({
  base_url: z.string().url().optional().describe("Optional override of the provider's default API base URL."),
}).strict();

const OpenAIModelProviderManifestSchema = WellKnownModelProviderManifestBaseSchema.extend({
  type: z.literal('openai'),
}).strict();

const AnthropicModelProviderManifestSchema = WellKnownModelProviderManifestBaseSchema.extend({
  type: z.literal('anthropic'),
}).strict();

/** Same fields as well-known providers, but base_url is required (no canonical endpoint). */
const CustomModelProviderManifestSchema = ModelProviderManifestBaseSchema.extend({
  type: z.literal('custom'),
  base_url: z.string().url().describe("Base URL of the provider's API."),
}).strict();

/**
 * Non-identity fields of a configured provider, shared verbatim between the
 * PUT request body and the persisted `model_provider.manifest` document.
 */
export const ModelProviderManifestObjectSchema = z.discriminatedUnion('type', [
  OpenAIModelProviderManifestSchema,
  AnthropicModelProviderManifestSchema,
  CustomModelProviderManifestSchema,
]);

export function refineModelProviderManifest(
  manifest: { models: { model_id: string; name: string }[] },
  ctx: z.RefinementCtx,
): void {
  refineUniqueModels(manifest.models, ctx);
}

export type ModelProperties = z.infer<typeof ModelPropertiesSchema>;
export type ModelProviderManifest = z.infer<typeof ModelProviderManifestObjectSchema>;

const OpenAIModelProviderSchema = OpenAIModelProviderManifestSchema.extend({
  name: NameSchema,
})
  .strict()
  .openapi('OpenAIModelProvider');

const AnthropicModelProviderSchema = AnthropicModelProviderManifestSchema.extend({
  name: NameSchema,
})
  .strict()
  .openapi('AnthropicModelProvider');

const CustomModelProviderSchema = CustomModelProviderManifestSchema.extend({
  name: NameSchema,
})
  .strict()
  .openapi('CustomModelProvider');

/**
 * Configured provider: PUT body and list/upsert response data (identity `name`
 * plus manifest fields, including `auth.api_key`).
 */
export const ModelProviderSchema = z
  .discriminatedUnion('type', [OpenAIModelProviderSchema, AnthropicModelProviderSchema, CustomModelProviderSchema])
  .superRefine(refineModelProviderManifest)
  .openapi('ModelProvider');

export const PutModelProviderRequestSchema = ModelProviderSchema;

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

export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type PutModelProviderRequest = ModelProvider;
export type Model = z.infer<typeof ModelSchema>;

/** Strip wire identity `name`; remaining fields are the persisted manifest document. */
export function toModelProviderManifest(provider: ModelProvider): ModelProviderManifest {
  const { name, ...manifest } = provider;
  void name;
  return manifest;
}
