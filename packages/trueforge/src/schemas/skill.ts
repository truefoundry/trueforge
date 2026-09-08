/**
 * Configured skill domain + wire schemas (`skill.manifest` JSONB and list projections).
 * Catalog presets live in skillCatalog.ts. SkillManifest is MCP-like: flat object, `type` $ref SkillType.
 */
import { z } from '@hono/zod-openapi';
import { NameSchema } from './common';

const SKILL_TYPES = ['git', 'registry'] as const;

/** OpenAPI + persisted discriminant (`git` | `registry`) — same pattern as MCPServerType. */
export const SkillTypeSchema = z.enum(SKILL_TYPES).openapi('SkillType');

// GitHub is exactly owner/repo; GitLab allows subgroups (group[/subgroup...]/project, ≥2 segments).
const GIT_URL_REGEX =
  /^https:\/\/(github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+|gitlab\.com\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)(\/|\.git)?$/;
const GIT_REF_REGEX = /^[A-Za-z0-9._\-/]+$/;
const SKILL_PATH_REGEX = /^[A-Za-z0-9._\-/]+$/;
const hasParentTraversal = (value: string): boolean => value.split('/').includes('..');

/** Shared with catalog presets — GitHub/GitLab HTTPS only. */
export const SkillGitUrlSchema = z
  .string()
  .trim()
  .min(1)
  .regex(GIT_URL_REGEX, 'Must be a GitHub or GitLab HTTPS URL')
  .refine(v => !hasParentTraversal(v), 'URL must not contain ".." segments')
  .describe('Full HTTPS URL of a GitHub or GitLab repository.');

/** Shared with catalog presets. Omit to use the repository root. */
export const SkillGitPathSchema = z
  .string()
  .trim()
  .min(1)
  .regex(SKILL_PATH_REGEX, 'Path may only contain letters, numbers, ".", "_", "-", and "/"')
  .refine(v => !hasParentTraversal(v), 'Path must not contain ".." segments')
  .refine(v => !v.split('/').includes('.'), 'Path must not contain "." segments')
  .refine(v => v.replace(/^\/+|\/+$/g, '').length > 0, 'Path must reference a subdirectory, not only slashes')
  .describe('Path to the skill directory within the repository. Omit to use the repository root.');

/**
 * Shared with catalog presets. Required on configured skills (no silent HEAD default).
 */
export const SkillGitRefSchema = z
  .string()
  .trim()
  .min(1)
  .regex(GIT_REF_REGEX, 'Ref may only contain letters, numbers, ".", "_", "-", and "/"')
  .refine(v => !hasParentTraversal(v), 'Ref must not contain ".." segments')
  .refine(v => v.replace(/^\/+|\/+$/g, '').length > 0, 'Ref must not consist only of slashes')
  .describe('Git ref — branch name, tag, or commit SHA.');

export const SkillDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .describe('Concise guidance for when the agent should use the skill.');

/** Runtime git shape (unnamed — not an OpenAPI component). */
const GitSkillManifestSchema = z
  .object({
    type: z.literal(SkillTypeSchema.enum.git),
    name: NameSchema,
    url: SkillGitUrlSchema,
    path: SkillGitPathSchema.optional(),
    ref: SkillGitRefSchema,
    description: SkillDescriptionSchema,
  })
  .strict();

/** Runtime registry shape (unnamed — not an OpenAPI component). */
const RegistrySkillManifestSchema = z
  .object({
    type: z.literal(SkillTypeSchema.enum.registry),
    name: NameSchema,
    description: SkillDescriptionSchema,
    fqn: z.string().min(1),
    skill_repo_name: z.string().min(1).describe('Repo where the skill is registered.'),
    version: z.number().int().positive(),
  })
  .strict();

/**
 * Persisted / OpenAPI manifest: one object with `type` $ref SkillType (like MCPServerManifest).
 * Per-type required fields: re-check via Git/Registry runtime schemas.
 */
const SkillManifestObjectSchema = z
  .object({
    type: SkillTypeSchema,
    name: NameSchema,
    description: SkillDescriptionSchema,
    url: SkillGitUrlSchema.optional(),
    path: SkillGitPathSchema.optional(),
    ref: SkillGitRefSchema.optional(),
    fqn: z.string().min(1).optional(),
    skill_repo_name: z.string().min(1).optional().describe('Repo where the skill is registered.'),
    version: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const parsed =
      value.type === 'git' ? GitSkillManifestSchema.safeParse(value) : RegistrySkillManifestSchema.safeParse(value);
    if (parsed.success) {
      return;
    }
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
  });

export const SkillManifestSchema = SkillManifestObjectSchema.openapi('SkillManifest');

export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type GitSkillManifest = z.infer<typeof GitSkillManifestSchema>;
export type RegistrySkillManifest = z.infer<typeof RegistrySkillManifestSchema>;

/** Narrow SkillManifest → git mount shape for turn resolve. */
export function parseGitSkillManifest(manifest: SkillManifest): GitSkillManifest | undefined {
  const parsed = GitSkillManifestSchema.safeParse(manifest);
  return parsed.success ? parsed.data : undefined;
}

/** Narrow SkillManifest → registry catalog shape for chat list projection. */
export function parseRegistrySkillManifest(manifest: SkillManifest): RegistrySkillManifest | undefined {
  const parsed = RegistrySkillManifestSchema.safeParse(manifest);
  return parsed.success ? parsed.data : undefined;
}

/** Admin/settings wire view: identity column plus nested manifest. */
export const ConfiguredSkillSchema = z
  .object({
    name: z.string().min(1),
    manifest: SkillManifestSchema,
  })
  .strict()
  .openapi('ConfiguredSkill');

/** Create/update $ref SkillManifest so OpenAPI SkillType stays git|registry (MCP-like). */
export const CreateSkillRequestSchema = z
  .object({
    manifest: SkillManifestSchema,
  })
  .strict()
  .openapi('CreateSkillRequest');

export const UpdateSkillRequestSchema = z
  .object({
    manifest: SkillManifestSchema,
  })
  .strict()
  .openapi('UpdateSkillRequest');

export const GetSkillResponseSchema = z.object({ data: ConfiguredSkillSchema }).openapi('GetSkillResponse');

/** Chat/composer read view — discovery fields only. */
export const AvailableSkillSchema = z
  .object({
    name: z.string().min(1).describe('Skill name.'),
    description: SkillDescriptionSchema,
    display_name: z.string().min(1).describe('Display name.'),
    skill_repo_name: z.string().min(1).optional().describe('Repo where the skill is registered.'),
    version: z.number().int().positive().optional().describe('Version number.'),
  })
  .strict()
  .openapi('AvailableSkill');

export const ListSkillsResponseSchema = z
  .object({ data: z.array(ConfiguredSkillSchema) })
  .openapi('ListSkillsResponse');

export const ListAvailableSkillsResponseSchema = z
  .object({ data: z.array(AvailableSkillSchema) })
  .openapi('ListAvailableSkillsResponse');

/** Versions list query — skill name (or registry FQN). */
export const ListSkillVersionsRequestQuerySchema = z
  .object({
    name: z.string().min(1).describe('Skill name.'),
  })
  .openapi('ListSkillVersionsRequestQuery');

/** One version row for the TrueFoundry skill picker dropdown. */
export const SkillVersionSchema = z
  .object({
    fqn: z.string().min(1),
    name: NameSchema,
    description: SkillDescriptionSchema,
    version: z.number().int().positive(),
  })
  .strict()
  .openapi('SkillVersion');

export const ListSkillVersionsResponseSchema = z
  .object({ data: z.array(SkillVersionSchema) })
  .openapi('ListSkillVersionsResponse');

export type ConfiguredSkill = z.infer<typeof ConfiguredSkillSchema>;
export type CreateSkillRequest = z.infer<typeof CreateSkillRequestSchema>;
export type UpdateSkillRequest = z.infer<typeof UpdateSkillRequestSchema>;
export type AvailableSkill = z.infer<typeof AvailableSkillSchema>;
export type SkillVersion = z.infer<typeof SkillVersionSchema>;
