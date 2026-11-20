import { z } from '@hono/zod-openapi';
import { NameSchema, type ResourceName } from './common';

const ZepMemoryProviderAuthSchema = z
  .object({
    api_key: z
      .string()
      .min(1)
      .describe(
        'Zep API key. Responses are redacted; on PUT, a real value sets/rotates and a redacted value keeps the stored key.',
      ),
  })
  .strict()
  .describe('Zep authentication credentials.')
  .openapi('ZepMemoryProviderAuth');

export const ZepMemoryProviderSchema = z
  .object({
    type: z.literal('zep').describe('Zep memory provider.'),
    server_url: z.url().optional().describe('Zep API URL. Defaults to Zep Cloud.'),
    auth: ZepMemoryProviderAuthSchema,
  })
  .strict();

export const MemoryProviderManifestSchema = z
  .discriminatedUnion('type', [ZepMemoryProviderSchema])
  .openapi('MemoryProviderManifest');

export function memoryProviderName(provider: MemoryProviderManifest): ResourceName {
  return provider.type;
}

export const ConfiguredMemoryProviderSchema = z
  .object({
    name: NameSchema,
    manifest: MemoryProviderManifestSchema,
  })
  .strict()
  .openapi('ConfiguredMemoryProvider');

export const UpdateMemoryProviderRequestSchema = z
  .object({
    manifest: MemoryProviderManifestSchema,
  })
  .strict()
  .openapi('UpdateMemoryProviderRequest');

export const GetMemoryProviderResponseSchema = z
  .object({
    data: ConfiguredMemoryProviderSchema,
  })
  .openapi('GetMemoryProviderResponse');

export type MemoryProviderManifest = z.infer<typeof MemoryProviderManifestSchema>;
export type ConfiguredMemoryProvider = z.infer<typeof ConfiguredMemoryProviderSchema>;
export type UpdateMemoryProviderRequest = z.infer<typeof UpdateMemoryProviderRequestSchema>;
