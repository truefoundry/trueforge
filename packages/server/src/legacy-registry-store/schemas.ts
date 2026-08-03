/**
 * Zod schemas for the legacy YAML registry files (models.yaml, mcp.yaml, skills.yaml).
 * Separate from DB-backed model-provider / catalog schemas under src/schemas/.
 * Validation is strict: unknown keys, duplicate names, or missing fields make
 * the server fail at startup.
 *
 * TODO: settle the `.openapi()` names below; they become the SDK's exported types.
 */
import { z } from '@hono/zod-openapi';
import { normalizeEnvName } from '../config';
import { uniqueNames } from '../schemas/common';

/**
 * Adds a validation issue if two names normalize to the same `{NAME}` env var
 * segment (e.g. "foo-bar" and "foo_bar"), since they couldn't get separate
 * per-name overrides.
 */
function uniqueEnvNames(entries: { name: string }[], ctx: z.RefinementCtx): void {
  const seenByEnvName = new Map<string, string>();
  for (const entry of entries) {
    const envName = normalizeEnvName(entry.name);
    const existing = seenByEnvName.get(envName);
    if (existing && existing !== entry.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Names "${existing}" and "${entry.name}" both map to the "${envName}" env var segment — rename one so they can be configured separately`,
      });
    } else {
      seenByEnvName.set(envName, entry.name);
    }
  }
}

const ModelEntryBaseSchema = z.object({
  /**
   * Display name / alias used in the API, env vars, and the registry.
   * Also sent to the provider as the model identifier when `model_id` is absent.
   */
  name: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9][a-z0-9.-]*$/,
      'name must start with a letter or digit and contain only lowercase a-z, 0-9, hyphens, and dots',
    ),
  /**
   * The model identifier sent to the provider (e.g. `anthropic/claude-sonnet-4-6`
   * for a gateway). Use when the provider-facing ID isn't a valid `name`.
   */
  model_id: z.string().min(1).optional(),
  max_output_tokens: z.number().int().positive(),
  reasoning_efforts: z.array(z.string().min(1)).min(1).optional(),
  /**
   * API key for this model, supports `${ENV_VAR}` substitution.
   * Falls back to MODEL_{NAME}_API_KEY, then MODEL_API_KEY when absent.
   */
  api_key: z.string().min(1).optional(),
  /**
   * Extra HTTP headers for requests to this model, supports `${ENV_VAR}` substitution.
   * Merged on top of MODEL_HEADERS and MODEL_{NAME}_HEADERS env var headers.
   */
  headers: z.record(z.string()).optional(),
});

/** OpenAI provider entry — always uses the Responses API. */
const OpenAIProviderEntrySchema = ModelEntryBaseSchema.extend({
  provider: z.literal('openai'),
  /** Override the default OpenAI base URL (e.g. Azure OpenAI endpoint). */
  base_url: z.string().url().optional(),
})
  .strict()
  .openapi('OpenAIProviderModelEntry');

/** Anthropic provider entry — backed by the dedicated Vercel AI SDK adapter. */
const AnthropicProviderEntrySchema = ModelEntryBaseSchema.extend({
  provider: z.literal('anthropic'),
  /** Override the provider's default base URL (e.g. point at a local proxy). */
  base_url: z.string().url().optional(),
})
  .strict()
  .openapi('AnthropicProviderModelEntry');

/** Google Gemini provider entry — backed by the dedicated Vercel AI SDK adapter. */
const GoogleGeminiProviderEntrySchema = ModelEntryBaseSchema.extend({
  provider: z.literal('google-gemini'),
  /** Override the provider's default base URL (e.g. point at a local proxy). */
  base_url: z.string().url().optional(),
})
  .strict()
  .openapi('GoogleGeminiProviderModelEntry');

/**
 * Generic OpenAI-compatible provider. Requires an explicit `base_url` since
 * there is no canonical endpoint.
 */
const GenericProviderEntrySchema = ModelEntryBaseSchema.extend({
  provider: z.literal('generic'),
  /** Deployment-specific base URL — required. */
  base_url: z.string().url(),
  /** API format used by this endpoint. Only option today; defaults when absent. */
  api_format: z.literal('openai-chat-completions').optional(),
})
  .strict()
  .openapi('GenericProviderModelEntry');

export const ModelEntrySchema = z
  .discriminatedUnion('provider', [
    OpenAIProviderEntrySchema,
    AnthropicProviderEntrySchema,
    GoogleGeminiProviderEntrySchema,
    GenericProviderEntrySchema,
  ])
  .openapi('ModelEntry');

export const ModelsFileSchema = z
  .object({
    models: z.array(ModelEntrySchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    uniqueNames(file.models, ctx);
    uniqueEnvNames(file.models, ctx);
  });

export const McpServerAuthSettingsSchema = z
  .discriminatedUnion('type', [z.object({ type: z.literal('dcr') })])
  .openapi('McpServerAuthSettings');

export const McpServerEntrySchema = z
  .object({
    name: z.string().min(1),
    url: z.string().url(),
    auth: McpServerAuthSettingsSchema.optional(),
  })
  .strict();

/**
 * `mcp_server.manifest` JSONB shape — the full mcp.yaml entry, including `name` (also kept as its
 * own DB column for the uniqueness index — duplicated, not split out, so the manifest blob always
 * round-trips the whole yaml entry as-is). Reuses `McpServerEntrySchema` directly rather than a
 * hand-written type, so the DB's stored shape can never drift from the yaml-validated one.
 */
export const McpServerManifestSchema = McpServerEntrySchema;

export const McpFileSchema = z
  .object({
    mcp_servers: z.array(McpServerEntrySchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    uniqueNames(file.mcp_servers, ctx);
    uniqueEnvNames(file.mcp_servers, ctx);
  });

export const SkillEntrySchema = z
  .object({
    name: z.string().min(1),
    // Public git repository containing the skill.
    url: z.string().url(),
    // Directory inside the repository containing SKILL.md. Repo root if omitted.
    path: z.string().min(1).optional(),
    // Branch, tag, or commit SHA to pin. Default branch if omitted.
    ref: z.string().min(1).optional(),
    // Shown to users and persisted in the selected skill mount for runtime prompting.
    description: z.string().min(1),
  })
  .strict()
  .openapi('SkillEntry');

export const SkillsFileSchema = z
  .object({
    skills: z.array(SkillEntrySchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    uniqueNames(file.skills, ctx);
  });

export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export type McpServerAuthSettings = z.infer<typeof McpServerAuthSettingsSchema>;
export type McpServerEntry = z.infer<typeof McpServerEntrySchema>;
export type McpServerManifest = z.infer<typeof McpServerManifestSchema>;
export type SkillEntry = z.infer<typeof SkillEntrySchema>;
