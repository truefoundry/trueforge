/**
 * Shipped model-catalog.yaml schemas (discovery presets). Separate from
 * configured provider manifests in modelProvider.ts.
 */
import { z } from '@hono/zod-openapi';
import { VERCEL_AI_PROVIDER_NAMES } from '@truefoundry/utils-core/core';
import { NameSchema, uniqueNames } from './common';
import { ModelEntrySchema, ReasoningEffortSchema, refineUniqueModels } from './modelProvider';

/** Includes `custom` so the catalog can carry a sentinel for supported_reasoning_efforts. */
const CatalogProviderTypeSchema = z.enum(VERCEL_AI_PROVIDER_NAMES).openapi('CatalogProviderType');

/**
 * Catalog entry. Well-known types list model presets; `custom` is a sentinel that
 * carries `supported_reasoning_efforts` for the custom-provider settings form.
 */
export const CatalogProviderSchema = z
  .object({
    type: CatalogProviderTypeSchema,
    name: NameSchema,
    logo: z.url().optional().describe('URL of the provider logo asset.'),
    models: z.array(ModelEntrySchema).describe('Preset models; empty on the `custom` sentinel.'),
    supported_reasoning_efforts: z
      .array(ReasoningEffortSchema)
      .min(1)
      .optional()
      .describe('Efforts the custom-provider form may advertise. Present only when type is `custom`.'),
  })
  .strict()
  .superRefine((provider, ctx) => {
    if (provider.type === 'custom') {
      if (provider.supported_reasoning_efforts === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'Catalog entry type "custom" requires supported_reasoning_efforts',
          path: ['supported_reasoning_efforts'],
        });
      }
      if (provider.models.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Catalog entry type "custom" must have an empty models list',
          path: ['models'],
        });
      }
      return;
    }
    if (provider.models.length < 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Well-known catalog providers require at least one model',
        path: ['models'],
      });
    }
    if (provider.supported_reasoning_efforts !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'supported_reasoning_efforts is only allowed on catalog type "custom"',
        path: ['supported_reasoning_efforts'],
      });
    }
  })
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
