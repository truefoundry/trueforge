/**
 * Shipped model-catalog.yaml schemas (discovery presets). Separate from
 * configured provider manifests in modelProvider.ts.
 */
import { z } from '@hono/zod-openapi';
import { uniqueTypes } from './common';
import {
  ConfiguredModelSchema,
  ModelProviderTypeSchema,
  ReasoningEffortSchema,
  refineUniqueModels,
} from './modelProvider';

/**
 * Catalog entry. Well-known types list model presets; `custom` is a sentinel that
 * carries `supported_reasoning_efforts` for the custom-provider settings form.
 * `truefoundry` is TrueFoundry-managed (not a user-savable preset), so it is excluded.
 */
export const CatalogWellKnownModelProviderTypeSchema = ModelProviderTypeSchema.exclude([
  'custom',
  'truefoundry',
]).openapi('CatalogWellKnownModelProviderType');

/** Same shape as a configured model; named for the catalog view it appears in. */
export const CatalogModelSchema = ConfiguredModelSchema.openapi('CatalogModel');

export const CatalogWellKnownModelProviderSchema = z
  .object({
    type: CatalogWellKnownModelProviderTypeSchema,
    logo: z.url().optional().describe('URL of the provider logo asset'),
    models: z.array(CatalogModelSchema).describe('Preset models'),
  })
  .strict()
  .openapi('CatalogWellKnownModelProvider');

export const CatalogCustomModelProviderSchema = z
  .object({
    type: z.literal('custom'),
    supported_reasoning_efforts: z
      .array(ReasoningEffortSchema)
      .describe('Supported reasoning-effort values for this provider'),
  })
  .strict()
  .openapi('CatalogCustomModelProvider');

export const CatalogModelProviderSchema = z
  .union([CatalogWellKnownModelProviderSchema, CatalogCustomModelProviderSchema])
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
