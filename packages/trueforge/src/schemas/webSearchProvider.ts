import { z } from '@hono/zod-openapi';
import { NameSchema, type ResourceName } from './common';

export const ParallelWebSearchModeSchema = z
  .enum(['turbo', 'fast', 'basic', 'advanced'])
  .describe('Parallel Search mode preset.')
  .openapi('ParallelWebSearchMode');

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

/** Single variant today (avoids one-member `oneOf` in OpenAPI). */
export const ParallelWebSearchProviderSchema = z
  .object({
    type: z.literal('parallel').describe('Parallel web-search provider.'),
    auth: ParallelWebSearchProviderAuthSchema,
    mode: ParallelWebSearchModeSchema,
  })
  .strict();

export const WebSearchProviderManifestSchema = ParallelWebSearchProviderSchema.openapi('WebSearchProviderManifest');

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

export const CreateWebSearchProviderRequestSchema = z
  .object({
    manifest: WebSearchProviderManifestSchema,
  })
  .strict()
  .openapi('CreateWebSearchProviderRequest');

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

export const ListWebSearchProvidersResponseSchema = z
  .object({
    data: z.array(ConfiguredWebSearchProviderSchema),
  })
  .openapi('ListWebSearchProvidersResponse');

export type ParallelWebSearchMode = z.infer<typeof ParallelWebSearchModeSchema>;
export type WebSearchProviderManifest = z.infer<typeof WebSearchProviderManifestSchema>;
export type ConfiguredWebSearchProvider = z.infer<typeof ConfiguredWebSearchProviderSchema>;
export type CreateWebSearchProviderRequest = z.infer<typeof CreateWebSearchProviderRequestSchema>;
export type UpdateWebSearchProviderRequest = z.infer<typeof UpdateWebSearchProviderRequestSchema>;
