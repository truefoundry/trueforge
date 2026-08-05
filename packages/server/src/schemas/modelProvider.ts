/**
 * Model-provider domain + wire schemas: configured provider manifests (DB /
 * PUT body) and OpenAPI request/response shapes. Catalog file schemas live on
 * ModelCatalog.
 */
import { z } from '@hono/zod-openapi';
import type { VercelAIProviderName } from '@truefoundry/utils-core/core';
import { SUPPORTED_REASONING_EFFORTS } from '@truefoundry/utils-core/core';
import { NameSchema, uniqueNames } from './common';

/**
 * A provider's endpoint is either already known or it isn't, and that is the only thing the wire
 * shape turns on. `openai`, `anthropic` and `google-gemini` get theirs from their dedicated Vercel
 * AI SDK adapter; the OpenAI-compatible ones named here get {@link PROVIDER_DEFAULT_BASE_URLS}.
 *
 * `satisfies` ties both lists to the adapters the harness can actually build. A type missing from
 * them is the dangerous direction — its catalog entries would be unconfigurable — so a test asserts
 * the two together cover every adapter.
 */
const WELL_KNOWN_BASE_URL_TYPES = [
  'openai',
  'anthropic',
  'google-gemini',
  'fireworks',
  'zai',
  'moonshot',
  'together',
] as const satisfies readonly VercelAIProviderName[];

/** `alibaba` scopes its endpoint to the caller's workspace, `custom` is arbitrary by definition. */
const CALLER_SUPPLIED_BASE_URL_TYPES = ['alibaba', 'custom'] as const satisfies readonly VercelAIProviderName[];

export const ProviderTypeSchema = z
  .enum([...WELL_KNOWN_BASE_URL_TYPES, ...CALLER_SUPPLIED_BASE_URL_TYPES])
  .openapi('ProviderType');

export type ProviderType = z.infer<typeof ProviderTypeSchema>;

/**
 * Endpoint to use when a manifest omits `base_url`. Absent means the provider's adapter supplies its
 * own, or that the schema required a `base_url` in the first place.
 */
export const PROVIDER_DEFAULT_BASE_URLS: Partial<Record<ProviderType, string>> = {
  fireworks: 'https://api.fireworks.ai/inference/v1',
  zai: 'https://api.z.ai/api/paas/v4',
  moonshot: 'https://api.moonshot.ai/v1',
  together: 'https://api.together.xyz/v1',
};

export const ModelPropertiesSchema = z
  .object({
    context_length: z.number().int().positive().optional(),
    max_output_tokens: z.number().int().positive().optional(),
    reasoning_efforts: z
      .array(
        z
          .string()
          .min(1)
          .refine(effort => SUPPORTED_REASONING_EFFORTS.includes(effort), {
            message: `Reasoning effort must be one of: ${SUPPORTED_REASONING_EFFORTS.join(', ')}`,
          }),
      )
      .min(1)
      .optional(),
  })
  .strict()
  .openapi('ModelProperties');

export const ModelEntrySchema = z
  .object({
    model_id: z.string().min(1).describe('Upstream, provider-specific identifier sent to the provider API.'),
    name: NameSchema.describe('Internal identifier; forms the fully qualified name `name/model_name`.'),
    properties: ModelPropertiesSchema,
  })
  .strict()
  .openapi('ModelEntry');

/** Adds issues when two models share a `model_id` or a `name`. */
export function refineUniqueModels(models: { model_id: string; name: string }[], ctx: z.RefinementCtx): void {
  uniqueNames(models, ctx);
  const seenModelIds = new Set<string>();
  for (const model of models) {
    if (seenModelIds.has(model.model_id)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate model_id "${model.model_id}" — model_ids must be unique within a provider`,
        path: ['models'],
      });
    }
    seenModelIds.add(model.model_id);
  }
}

const ModelProviderAuthSchema = z
  .object({
    api_key: z.string().min(1),
  })
  .strict()
  .openapi('ModelProviderAuth');

const ModelProviderManifestBaseSchema = z
  .object({
    auth: ModelProviderAuthSchema,
    models: z.array(ModelEntrySchema).min(1),
  })
  .strict();

/** The endpoint is already known, so `base_url` only overrides it. */
const WellKnownModelProviderManifestSchema = ModelProviderManifestBaseSchema.extend({
  type: z.enum(WELL_KNOWN_BASE_URL_TYPES),
  base_url: z.url().optional().describe("Optional override of the provider's default API base URL."),
}).strict();

/** Nothing to fall back on, so `base_url` is required. */
const CallerSuppliedModelProviderManifestSchema = ModelProviderManifestBaseSchema.extend({
  type: z.enum(CALLER_SUPPLIED_BASE_URL_TYPES),
  base_url: z.url().describe("Base URL of the provider's API."),
}).strict();

/**
 * Non-identity fields of a configured provider, shared verbatim between the
 * PUT request body and the persisted `model_provider.manifest` document.
 */
export const ModelProviderManifestObjectSchema = z.union([
  WellKnownModelProviderManifestSchema,
  CallerSuppliedModelProviderManifestSchema,
]);

export function refineModelProviderManifest(
  manifest: { models: { model_id: string; name: string }[] },
  ctx: z.RefinementCtx,
): void {
  refineUniqueModels(manifest.models, ctx);
}

export type ModelProperties = z.infer<typeof ModelPropertiesSchema>;
export type ModelProviderManifest = z.infer<typeof ModelProviderManifestObjectSchema>;

const WellKnownModelProviderSchema = WellKnownModelProviderManifestSchema.extend({ name: NameSchema })
  .strict()
  .openapi('WellKnownModelProvider');

const CallerSuppliedModelProviderSchema = CallerSuppliedModelProviderManifestSchema.extend({ name: NameSchema })
  .strict()
  .openapi('CallerSuppliedModelProvider');

/**
 * Configured provider: PUT body and list/upsert response data (identity `name`
 * plus manifest fields, including `auth.api_key`).
 */
export const ModelProviderSchema = z
  .union([WellKnownModelProviderSchema, CallerSuppliedModelProviderSchema])
  .superRefine(refineModelProviderManifest)
  .openapi('ModelProvider');

export const PutModelProviderRequestSchema = ModelProviderSchema;

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
    name: z
      .string()
      .describe('Fully qualified name `provider_name/model_name`, e.g. "openai/gpt-5-6-sol". Unique within a tenant.'),
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

export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type PutModelProviderRequest = ModelProvider;
export type Model = z.infer<typeof ModelSchema>;

/** Strip wire identity `name`; remaining fields are the persisted manifest document. */
export function toModelProviderManifest(provider: ModelProvider): ModelProviderManifest {
  const { name, ...manifest } = provider;
  void name;
  return manifest;
}
