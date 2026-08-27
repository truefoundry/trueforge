/**
 * Shipped sandbox-catalog.yaml schemas (discovery presets). Separate from
 * configured provider manifests in sandboxProvider.ts.
 */
import { z } from '@hono/zod-openapi';
import { DaytonaSandboxProviderSchema, DockerSandboxProviderSchema } from './sandboxProvider';

/**
 * Catalog wire type: presets for discovery, with credentials stripped. Docker has
 * no auth field to strip, so it enters the union unchanged.
 */
export const CatalogSandboxProviderSchema = z
  .discriminatedUnion('type', [DaytonaSandboxProviderSchema.omit({ auth: true }).strict(), DockerSandboxProviderSchema])
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
