/**
 * Shipped sandbox-catalog.yaml schemas (discovery presets). Separate from
 * configured provider manifests in sandboxProvider.ts.
 */
import { z } from '@hono/zod-openapi';
import { DaytonaSandboxProviderSchema } from './sandboxProvider';

/** Catalog entry: Daytona preset without secrets. */
export const CatalogDaytonaSandboxProviderSchema = DaytonaSandboxProviderSchema.omit({ auth: true })
  .strict()
  .openapi('CatalogDaytonaSandboxProvider');

/**
 * Catalog wire type. Single variant today (avoids one-member `oneOf` in OpenAPI).
 * Widen to a discriminated union when a second provider ships.
 */
export const CatalogSandboxProviderSchema = CatalogDaytonaSandboxProviderSchema;

export const SandboxCatalogFileSchema = z
  .object({
    providers: z.array(CatalogSandboxProviderSchema),
  })
  .strict();

export const GetSandboxProviderCatalogResponseSchema = z
  .object({
    data: z.array(CatalogSandboxProviderSchema),
  })
  .openapi('GetSandboxProviderCatalogResponse');

export type CatalogDaytonaSandboxProvider = z.infer<typeof CatalogDaytonaSandboxProviderSchema>;
export type CatalogSandboxProvider = z.infer<typeof CatalogSandboxProviderSchema>;
export type SandboxCatalogFile = z.infer<typeof SandboxCatalogFileSchema>;
