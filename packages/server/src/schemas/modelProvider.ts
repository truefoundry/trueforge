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

const ProviderAuthSchema = z
  .object({
    api_key: z.string().min(1),
  })
  .strict()
  .openapi('ModelProviderAuth');

/**
 * Non-identity fields of a configured provider, shared verbatim between the
 * PUT request body and the persisted `model_provider.manifest` document.
 * Compose with `.superRefine(refineProviderManifest)` after any `.extend()`.
 */
export const ProviderManifestObjectSchema = z
  .object({
    type: ProviderTypeSchema,
    base_url: z.string().url().describe("Base URL of the provider's API."),
    auth: ProviderAuthSchema,
    models: z.array(ModelEntrySchema).min(1),
  })
  .strict();

export function refineProviderManifest(
  manifest: { models: { model_id: string; name: string }[] },
  ctx: z.RefinementCtx,
): void {
  refineUniqueModels(manifest.models, ctx);
}

export type ModelProperties = z.infer<typeof ModelPropertiesSchema>;
export type ProviderManifest = z.infer<typeof ProviderManifestObjectSchema>;

/**
 * Configured provider: PUT body and list/upsert response data (identity `name`
 * plus manifest fields, including `auth.api_key`).
 */
export const ModelProviderSchema = ProviderManifestObjectSchema.extend({
  name: NameSchema,
})
  .superRefine(refineProviderManifest)
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
    name: z.string().describe('Fully qualified name `name/model_name`, e.g. "openai/gpt-5-6-sol".'),
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
