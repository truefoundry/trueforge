/**
 * Zod schemas for the YAML config files (models.yaml, mcp.yaml, skills.yaml).
 * Validation is strict: unknown keys, duplicate names, or missing fields make
 * the server fail at startup.
 *
 * TODO: settle the `.openapi()` names below; they become the SDK's exported types.
 */
import { z } from '@hono/zod-openapi';
import { normalizeEnvName } from '../config';

/** Adds a validation issue if two entries share a name. */
function uniqueNames(entries: { name: string }[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate name "${entry.name}" — names must be unique`,
      });
    }
    seen.add(entry.name);
  }
}

/**
 * Adds a validation issue if two distinct names normalize to the same
 * `{NAME}` env var segment (e.g. "foo-bar" and "foo_bar"), since they could
 * not be given separate per-name overrides (headers, API keys). Only applied
 * to entries with per-name env vars (models, MCP servers).
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
   * Display name / alias used to reference the model in the API, env vars, and
   * the registry. Constrained to lowercase letters, digits, hyphens, and dots so
   * it can be safely embedded in env var names without ambiguity.
   * When `model_id` is absent this value is also sent to the provider as the
   * model identifier.
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
   * for a gateway, or `claude-sonnet-4-6` for a direct Anthropic call).
   * When absent, `name` is used as the provider model identifier.
   * Use this when the provider-facing ID contains characters (slashes, colons, …)
   * that are not valid in a `name`.
   */
  model_id: z.string().min(1).optional(),
  max_output_tokens: z.number().int().positive(),
  reasoning_efforts: z.array(z.string().min(1)).min(1).optional(),
  /**
   * API key for this model. Supports `${ENV_VAR}` substitution — the server
   * resolves the env var at startup. Use this instead of the MODEL_{NAME}_API_KEY
   * env var convention when you need direct control over which env var is read.
   *
   * Example: `api_key: "${ANTHROPIC_API_KEY}"`
   *
   * Falls back to MODEL_{NAME}_API_KEY, then MODEL_API_KEY when absent.
   */
  api_key: z.string().min(1).optional(),
  /**
   * Extra HTTP headers sent with every request to this model.
   * Header values support `${ENV_VAR}` substitution.
   *
   * Example:
   *   headers:
   *     X-Custom-Header: "literal"
   *     Authorization: "Bearer ${MY_TOKEN}"
   *
   * Merged on top of MODEL_HEADERS and MODEL_{NAME}_HEADERS env var headers.
   */
  headers: z.record(z.string()).optional(),
});

/** OpenAI provider entry — always uses the Responses API. */
const OpenAIProviderEntrySchema = ModelEntryBaseSchema.extend({
  provider: z.literal('openai'),
  /** Override the default OpenAI base URL (e.g. Azure OpenAI endpoint). */
  base_url: z.string().url().optional(),
}).strict();

/** First-party providers backed by dedicated Vercel AI SDK adapters. */
const FirstPartyProviderEntrySchema = ModelEntryBaseSchema.extend({
  provider: z.enum(['anthropic', 'google-gemini']),
  /** Override the provider's default base URL (e.g. point at a local proxy). */
  base_url: z.string().url().optional(),
}).strict();

/**
 * Generic OpenAI-compatible provider. Requires an explicit `base_url` since
 * there is no canonical endpoint.
 */
const GenericProviderEntrySchema = ModelEntryBaseSchema.extend({
  provider: z.literal('generic'),
  /** Deployment-specific base URL — required. */
  base_url: z.string().url(),
  /**
   * API format used by this endpoint. Only `openai-chat-completions` is
   * supported today; additional formats will be added here when implemented.
   * Defaults to `openai-chat-completions` when absent.
   */
  api_format: z.literal('openai-chat-completions').optional(),
}).strict();

export const ModelEntrySchema = z
  .union([OpenAIProviderEntrySchema, FirstPartyProviderEntrySchema, GenericProviderEntrySchema])
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

export const McpServerEntrySchema = z
  .object({
    name: z.string().min(1),
    url: z.string().url(),
  })
  .strict()
  .openapi('McpServerEntry');

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
export type McpServerEntry = z.infer<typeof McpServerEntrySchema>;
export type SkillEntry = z.infer<typeof SkillEntrySchema>;
