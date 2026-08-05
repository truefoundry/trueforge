/**
 * Shipped model-catalog.yaml schemas (discovery presets). Separate from
 * configured provider manifests in modelProvider.ts.
 */
import { z } from '@hono/zod-openapi';
import { NameSchema, uniqueNames } from './common';
import { ModelEntrySchema, ProviderTypeSchema, refineUniqueModels } from './modelProvider';

/** Catalog entry: no `custom` providers — those exist only as tenant configuration. */
export const CatalogProviderSchema = z
  .object({
    type: ProviderTypeSchema.exclude(['custom']),
    name: NameSchema,
    logo: z.url().optional().describe('URL of the provider logo asset.'),
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

export const GetModelProviderCatalogResponseSchema = z
  .object({
    data: z.array(CatalogProviderSchema),
  })
  .openapi('GetModelProviderCatalogResponse');

export type CatalogProvider = z.infer<typeof CatalogProviderSchema>;
export type ModelCatalogFile = z.infer<typeof ModelCatalogFileSchema>;
