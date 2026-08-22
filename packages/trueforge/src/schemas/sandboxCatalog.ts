/**
 * Shipped sandbox-catalog.yaml schemas (discovery presets). Separate from
 * configured provider manifests in sandboxProvider.ts.
 */
import { z } from '@hono/zod-openapi';
import { DaytonaSandboxProviderConfigSchema, E2BSandboxProviderConfigSchema } from './sandboxProvider';

/**
 * Catalog variants stay flat and named so generated clients receive a direct discriminated union.
 */
export const CatalogDaytonaSandboxProviderSchema = z
  .object({
    type: z.literal('daytona').describe('Daytona sandbox provider.'),
    ...DaytonaSandboxProviderConfigSchema.shape,
  })
  .strict()
  .openapi('CatalogDaytonaSandboxProvider');

export const CatalogE2BSandboxProviderSchema = z
  .object({
    type: z.literal('e2b').describe('E2B sandbox provider.'),
    ...E2BSandboxProviderConfigSchema.shape,
  })
  .strict()
  .openapi('CatalogE2BSandboxProvider');

export const CatalogSandboxProviderSchema = z
  .discriminatedUnion('type', [CatalogDaytonaSandboxProviderSchema, CatalogE2BSandboxProviderSchema])
  .openapi('CatalogSandboxProvider');

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

export type CatalogSandboxProvider = z.infer<typeof CatalogSandboxProviderSchema>;
export type SandboxCatalogFile = z.infer<typeof SandboxCatalogFileSchema>;
