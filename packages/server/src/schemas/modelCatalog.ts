/**
 * Shipped model-catalog.yaml schemas (discovery presets). Separate from
 * configured provider manifests in modelProvider.ts.
 */
import { z } from '@hono/zod-openapi';
import { uniqueTypes } from './common';
import { ModelEntrySchema, ModelProviderTypeSchema, ReasoningEffortSchema, refineUniqueModels } from './modelProvider';

/**
 * Catalog entry. Well-known types list model presets; `custom` is a sentinel that
 * carries `supported_reasoning_efforts` for the custom-provider settings form.
 */
export const CatalogWellKnownModelProviderSchema = z
  .object({
    type: ModelProviderTypeSchema.exclude(['custom']).describe('Well-known provider type (catalog excludes `custom`).'),
    logo: z.url().optional().describe('URL of the provider logo asset.'),
    models: z.array(ModelEntrySchema).describe('Preset models; empty on the `custom` sentinel.'),
  })
  .strict()
  .openapi('CatalogWellKnownModelProvider');

export const CatalogCustomModelProviderSchema = z
  .object({
    type: z.literal('custom').describe('Custom provider type (catalog includes `custom`).'),
    supported_reasoning_efforts: z
      .array(ReasoningEffortSchema)
      .describe('Supported reasoning-effort values for this provider.'),
  })
  .strict()
  .openapi('CatalogCustomModelProvider');

export const CatalogModelProviderSchema = z
  .discriminatedUnion('type', [CatalogWellKnownModelProviderSchema, CatalogCustomModelProviderSchema])
  .openapi('CatalogModelProvider');

export const ModelCatalogFileSchema = z
  .object({
    providers: z.array(CatalogWellKnownModelProviderSchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    uniqueTypes(file.providers, ctx);
    for (const provider of file.providers) {
      refineUniqueModels(provider.models, ctx);
    }
  });

export const GetModelProviderCatalogResponseSchema = z
  .object({
    data: z.array(CatalogModelProviderSchema),
  })
  .openapi('GetModelProviderCatalogResponse');

export type CatalogWellKnownModelProvider = z.infer<typeof CatalogWellKnownModelProviderSchema>;
export type CatalogModelProvider = z.infer<typeof CatalogModelProviderSchema>;
export type ModelCatalogFile = z.infer<typeof ModelCatalogFileSchema>;
