import { z } from '@hono/zod-openapi';
import { NameSchema, type ResourceName } from './common';

const ParallelWebSearchProviderAuthSchema = z
  .object({
    api_key: z
      .string()
      .min(1)
      .describe(
        'Parallel API key. Responses are redacted; on PUT, a real value sets/rotates and a redacted value keeps the stored key.',
      ),
  })
  .strict()
  .describe('Parallel authentication credentials.')
  .openapi('ParallelWebSearchProviderAuth');

export const ParallelWebSearchProviderSchema = z
  .object({
    type: z.literal('parallel').describe('Parallel web-search provider.'),
    auth: ParallelWebSearchProviderAuthSchema,
  })
  .strict();

export const WebSearchProviderManifestSchema = z
  .discriminatedUnion('type', [ParallelWebSearchProviderSchema])
  .openapi('WebSearchProviderManifest');

export function webSearchProviderName(provider: WebSearchProviderManifest): ResourceName {
  return provider.type;
}

export const ConfiguredWebSearchProviderSchema = z
  .object({
    name: NameSchema,
    manifest: WebSearchProviderManifestSchema,
  })
  .strict()
  .openapi('ConfiguredWebSearchProvider');

export const UpdateWebSearchProviderRequestSchema = z
  .object({
    manifest: WebSearchProviderManifestSchema,
  })
  .strict()
  .openapi('UpdateWebSearchProviderRequest');

export const GetWebSearchProviderResponseSchema = z
  .object({
    data: ConfiguredWebSearchProviderSchema,
  })
  .openapi('GetWebSearchProviderResponse');

export type WebSearchProviderManifest = z.infer<typeof WebSearchProviderManifestSchema>;
export type ConfiguredWebSearchProvider = z.infer<typeof ConfiguredWebSearchProviderSchema>;
export type UpdateWebSearchProviderRequest = z.infer<typeof UpdateWebSearchProviderRequestSchema>;
