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

/**
 * OpenAI-compatible providers that need an explicit `base_url` because they
 * have no canonical well-known endpoint, or where the endpoint is
 * deployment-specific (LiteLLM, TrueFoundry, generic compat).
 */
const CompatProviderSchema = z.enum(['openai-compatible', 'litellm', 'truefoundry']);

const ModelEntryBaseSchema = z.object({
  name: z.string().min(1),
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

/**
 * OpenAI provider entry. Supports `openai_api` to select between the Responses
 * API (default, required for o-series reasoning models) and the Chat Completions
 * API (opt-in for legacy deployments or models that don't support Responses).
 */
const OpenAIProviderEntrySchema = ModelEntryBaseSchema.extend({
  provider: z.literal('openai'),
  /** Override the default OpenAI base URL (e.g. Azure OpenAI endpoint). */
  base_url: z.string().url().optional(),
  /**
   * Which OpenAI API to use. Defaults to 'responses' (the Responses API, which
   * supports reasoning models and stateless multi-turn via encrypted content).
   * Use 'chat' for models or deployments that don't support the Responses API.
   */
  openai_api: z.enum(['responses', 'chat']).optional(),
}).strict();

/** All other first-party providers with Vercel AI SDK support. */
const OtherKnownProviderEntrySchema = ModelEntryBaseSchema.extend({
  provider: z.enum(['anthropic', 'google', 'mistral', 'openrouter', 'portkey', 'kimi']),
  /** Override the provider's default base URL (e.g. point at a local proxy). */
  base_url: z.string().url().optional(),
}).strict();

const CompatProviderEntrySchema = ModelEntryBaseSchema.extend({
  provider: CompatProviderSchema,
  /** Deployment-specific base URL — required for compat providers. */
  base_url: z.string().url(),
  /**
   * Which OpenAI API surface to use. Defaults to 'chat' (Chat Completions),
   * which works with any OpenAI-compatible gateway. Use 'responses' only for
   * gateways that expose the OpenAI Responses API endpoint (enables `store: false`
   * and stateless multi-turn reasoning via encrypted content).
   */
  openai_api: z.enum(['responses', 'chat']).optional(),
}).strict();

export const ModelEntrySchema = z
  .union([OpenAIProviderEntrySchema, OtherKnownProviderEntrySchema, CompatProviderEntrySchema])
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
