import { z } from '@hono/zod-openapi';
import { ZepMemoryProviderSchema } from './memoryProvider';

export const CatalogMemoryProviderSchema = ZepMemoryProviderSchema.omit({ auth: true, server_url: true })
  .strict()
  .openapi('CatalogMemoryProvider');

export const MemoryCatalogFileSchema = z
  .object({
    providers: z.array(CatalogMemoryProviderSchema),
  })
  .strict();

export const GetMemoryProviderCatalogResponseSchema = z
  .object({
    data: z.array(CatalogMemoryProviderSchema),
  })
  .openapi('GetMemoryProviderCatalogResponse');

export type CatalogMemoryProvider = z.infer<typeof CatalogMemoryProviderSchema>;
export type MemoryCatalogFile = z.infer<typeof MemoryCatalogFileSchema>;
