/** Wire schemas for the model-provider management surface and the FQN models read surface. */
import { z } from '@hono/zod-openapi';
import {
  CatalogProviderSchema,
  ModelEntrySchema,
  ModelPropertiesSchema,
  NameSchema,
  ProviderManifestObjectSchema,
  ProviderTypeSchema,
  refineProviderManifest,
} from '../catalog/schemas';

/** Full upsert body: identity `name` plus the manifest fields, copied verbatim from the catalog. */
export const PutModelProviderRequestSchema = ProviderManifestObjectSchema.extend({
  name: NameSchema,
})
  .superRefine(refineProviderManifest)
  .openapi('PutModelProviderRequest');

/**
 * `auth.api_key` is never echoed back: responses only confirm a key is stored.
 * Returning stored secrets on every settings load would be a leak.
 */
export const ModelProviderAuthStatusSchema = z
  .object({
    api_key_set: z.literal(true),
  })
  .strict()
  .openapi('ModelProviderAuthStatus');

export const ModelProviderSchema = z
  .object({
    type: ProviderTypeSchema,
    name: NameSchema,
    base_url: z.string().url(),
    auth: ModelProviderAuthStatusSchema,
    models: z.array(ModelEntrySchema).min(1),
  })
  .strict()
  .openapi('ModelProvider');

export const GetModelProviderCatalogResponseSchema = z
  .object({
    data: z.array(CatalogProviderSchema),
  })
  .openapi('GetModelProviderCatalogResponse');

export const ListModelProvidersResponseSchema = z
  .object({
    data: z.array(ModelProviderSchema),
  })
  .openapi('ListModelProvidersResponse');

export const PutModelProviderResponseSchema = z
  .object({
    data: ModelProviderSchema,
  })
  .openapi('PutModelProviderResponse');

/** Read view: the fully qualified name resolves the provider, so no provider object is nested. */
export const ModelSchema = z
  .object({
    name: z.string().describe('Fully qualified name `provider_name/model_name`, e.g. "openai/gpt-5-6-sol".'),
    model_id: z.string().describe('Upstream, provider-specific identifier sent to the provider API.'),
    properties: ModelPropertiesSchema,
  })
  .strict()
  .openapi('Model');

export const ListModelsResponseSchema = z
  .object({
    data: z.array(ModelSchema),
  })
  .openapi('ListModelsResponse');

export type PutModelProviderRequest = z.infer<typeof PutModelProviderRequestSchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
