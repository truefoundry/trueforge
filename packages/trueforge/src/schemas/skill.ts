/**
 * Configured skill domain + wire schemas (`skill.manifest` JSONB and list projections).
 * Catalog presets live in skillCatalog.ts.
 * SkillManifest is a `type`-discriminated oneOf of GitSkill | RegistrySkill.
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

const GitSkillSchema = z
  .object({
    type: z.literal(SkillTypeSchema.enum.git),
    name: NameSchema,
    url: SkillGitUrlSchema,
    path: SkillGitPathSchema.optional(),
    ref: SkillGitRefSchema,
    description: SkillDescriptionSchema,
  })
  .strict()
  .openapi('GitSkill');

/** Registry catalog row: `name` is the version FQN (unique); `display_name` is the short SFY name. */
const RegistrySkillSchema = z
  .object({
    type: z.literal(SkillTypeSchema.enum.registry),
    name: z.string().min(1),
    display_name: z.string().min(1),
    description: SkillDescriptionSchema,
    skill_repo_name: z.string().min(1).describe('Repo where the skill is registered.'),
    version: z.number().int().positive(),
  })
  .strict()
  .openapi('RegistrySkill');

export const SkillManifestSchema = z
  .discriminatedUnion('type', [GitSkillSchema, RegistrySkillSchema])
  .openapi('SkillManifest');

export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type GitSkill = z.infer<typeof GitSkillSchema>;
export type RegistrySkill = z.infer<typeof RegistrySkillSchema>;

/** Narrow SkillManifest → git mount shape for turn resolve. */
export function parseGitSkill(manifest: SkillManifest): GitSkill | undefined {
  return manifest.type === 'git' ? manifest : undefined;
}

/** Narrow SkillManifest → registry catalog shape for chat list projection. */
export function parseRegistrySkill(manifest: SkillManifest): RegistrySkill | undefined {
  return manifest.type === 'registry' ? manifest : undefined;
}

/** Admin/settings wire view: identity column plus nested manifest. */
export const ConfiguredSkillSchema = z
  .object({
    name: z.string().min(1),
    manifest: SkillManifestSchema,
  })
  .strict()
  .openapi('ConfiguredSkill');

/** Create/update $ref SkillManifest so OpenAPI SkillType stays git|registry. */
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
    display_name: z.string().min(1).optional().describe('Display name of the skill.'),
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

/** One version row for the TrueFoundry skill picker dropdown. `name` is the version FQN. */
export const SkillVersionSchema = z
  .object({
    name: z.string().min(1),
    display_name: z.string().min(1),
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
