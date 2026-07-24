/**
 * Zod schemas for the YAML config files (models.yaml, mcp.yaml, skills.yaml).
 * Validation is strict: unknown keys, duplicate names, or missing fields make
 * the server fail at startup.
 */
import { z } from 'zod';
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

export const ModelEntrySchema = z
  .object({
    name: z.string().min(1),
    reasoning_efforts: z.array(z.string().min(1)).min(1).optional(),
    max_output_tokens: z.number().int().positive(),
  })
  .strict();

export const ModelsFileSchema = z
  .object({
    base_url: z
      .string()
      .url()
      .transform(url => url.replace(/\/$/, '')),
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
  .strict();

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
  .strict();

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
