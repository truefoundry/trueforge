import { z } from '@hono/zod-openapi';
import { ParallelWebSearchProviderSchema } from './webSearchProvider';

export const CatalogWebSearchProviderSchema = ParallelWebSearchProviderSchema.omit({ auth: true })
  .strict()
  .openapi('CatalogWebSearchProvider');

export const WebSearchCatalogFileSchema = z
  .object({
    providers: z.array(CatalogWebSearchProviderSchema),
  })
  .strict();

export const GetWebSearchProviderCatalogResponseSchema = z
  .object({
    data: z.array(CatalogWebSearchProviderSchema),
  })
  .openapi('GetWebSearchProviderCatalogResponse');

export type CatalogWebSearchProvider = z.infer<typeof CatalogWebSearchProviderSchema>;
export type WebSearchCatalogFile = z.infer<typeof WebSearchCatalogFileSchema>;
