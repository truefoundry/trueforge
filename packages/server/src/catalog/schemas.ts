/**
 * Canonical schemas for the model catalog (model-catalog.yaml) and configured
 * model providers (the `model_provider.manifest` jsonb document).
 *
 * All user-supplied string validation lives here at the Zod layer: API routes
 * and stores reuse these schemas instead of re-checking in SQL or handlers.
 */
import { z } from '@hono/zod-openapi';
import { uniqueNames } from '../store/schemas';

/** Slug used in fully qualified model names (provider_name/model_name). */
export const NameSchema = z
  .string()
  .max(64)
  .regex(
    /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/,
    'must be a lowercase slug: alphanumerics, optionally separated by ".", "_" or "-"',
  )
  .openapi('ResourceName');

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
    name: NameSchema.describe('Internal identifier; forms the fully qualified name `provider_name/model_name`.'),
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

export const CatalogProviderSchema = z
  .object({
    // The catalog never carries `custom` entries: those exist only as tenant configuration.
    type: ProviderTypeSchema.exclude(['custom']),
    name: NameSchema,
    models: z.array(ModelEntrySchema).min(1),
  })
  .strict()
  .openapi('CatalogProvider');

export const ModelCatalogFileSchema = z
  .object({
    providers: z.array(CatalogProviderSchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    uniqueNames(file.providers, ctx);
    for (const provider of file.providers) {
      refineUniqueModels(provider.models, ctx);
    }
  });

export const ProviderAuthSchema = z
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

export function refineProviderManifest(manifest: { models: ModelEntry[] }, ctx: z.RefinementCtx): void {
  refineUniqueModels(manifest.models, ctx);
}

export const ProviderManifestSchema = ProviderManifestObjectSchema.superRefine(refineProviderManifest);

export type ResourceName = z.infer<typeof NameSchema>;
export type ProviderType = z.infer<typeof ProviderTypeSchema>;
export type ModelProperties = z.infer<typeof ModelPropertiesSchema>;
export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export type CatalogProvider = z.infer<typeof CatalogProviderSchema>;
export type ModelCatalogFile = z.infer<typeof ModelCatalogFileSchema>;
export type ProviderAuth = z.infer<typeof ProviderAuthSchema>;
export type ProviderManifest = z.infer<typeof ProviderManifestSchema>;
