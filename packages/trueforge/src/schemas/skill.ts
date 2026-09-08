/**
 * Configured skill domain + wire schemas: the `skill.manifest` JSONB document
 * and admin/chat list projections. Catalog file schemas live in skillCatalog.ts.
 *
 * Git field rules mirror harness git skill mounts (GitHub/GitLab HTTPS url,
 * path/ref constraints) so settings documents stay mount-compatible. Identity
 * uses NameSchema like model providers / MCP servers.
 *
 * OpenAPI matches MCPServerManifest: one SkillManifest with `type: SkillType`
 * inside (no GitSkillManifest / RegistrySkillManifest components).
 */
import { z } from '@hono/zod-openapi';
import { NameSchema } from './common';

/** Kind of skill — same pattern as MCPServerType. */
export const SkillTypeSchema = z.enum(['git', 'registry']).openapi('SkillType');

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

/**
 * Persisted skill document. Single object like MCPServerManifest (`type` inside).
 * Git vs registry required fields are enforced in superRefine.
 */
export const SkillManifestObjectSchema = z
  .object({
    type: SkillTypeSchema,
    name: NameSchema,
    description: SkillDescriptionSchema,
    url: SkillGitUrlSchema.optional(),
    path: SkillGitPathSchema.optional(),
    ref: SkillGitRefSchema.optional(),
    id: z.string().min(1).optional(),
    fqn: z.string().min(1).optional(),
    skill_repo_name: z.string().min(1).optional().describe('Repo where the skill is registered.'),
    version: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === 'git') {
      if (value.url === undefined) {
        ctx.addIssue({ code: 'custom', message: 'url is required for git skills', path: ['url'] });
      }
      if (value.ref === undefined) {
        ctx.addIssue({ code: 'custom', message: 'ref is required for git skills', path: ['ref'] });
      }
      return;
    }
    for (const key of ['id', 'fqn', 'skill_repo_name', 'version'] as const) {
      if (value[key] === undefined) {
        ctx.addIssue({ code: 'custom', message: `${key} is required for registry skills`, path: [key] });
      }
    }
  });

export const SkillManifestSchema = SkillManifestObjectSchema.openapi('SkillManifest');

/**
 * Settings write shape (git only). Unnamed so OpenAPI does not emit GitSkillManifest;
 * create/update bodies still require git fields via SkillType + refine.
 */
export const GitSkillManifestSchema = z
  .object({
    type: SkillTypeSchema,
    name: NameSchema,
    url: SkillGitUrlSchema,
    path: SkillGitPathSchema.optional(),
    ref: SkillGitRefSchema,
    description: SkillDescriptionSchema,
  })
  .strict()
  .refine(value => value.type === 'git', { path: ['type'], message: 'must be git' });

/** Registry row shape for TrueFoundry catalog mapping. Unnamed — not an OpenAPI component. */
export const RegistrySkillManifestSchema = z
  .object({
    type: SkillTypeSchema,
    name: NameSchema,
    description: SkillDescriptionSchema,
    id: z.string().min(1),
    fqn: z.string().min(1),
    skill_repo_name: z.string().min(1).describe('Repo where the skill is registered.'),
    version: z.number().int().positive(),
  })
  .strict()
  .refine(value => value.type === 'registry', { path: ['type'], message: 'must be registry' });

/** Admin/settings wire view: identity column plus nested manifest. */
export const ConfiguredSkillSchema = z
  .object({
    name: NameSchema,
    manifest: SkillManifestSchema,
  })
  .strict()
  .openapi('ConfiguredSkill');

export const CreateSkillRequestSchema = z
  .object({
    manifest: GitSkillManifestSchema,
  })
  .strict()
  .openapi('CreateSkillRequest');

export const UpdateSkillRequestSchema = z
  .object({
    manifest: GitSkillManifestSchema,
  })
  .strict()
  .openapi('UpdateSkillRequest');

export const GetSkillResponseSchema = z.object({ data: ConfiguredSkillSchema }).openapi('GetSkillResponse');

/** Chat/composer read view — discovery fields only. */
export const AvailableSkillSchema = z
  .object({
    name: z.string().min(1).describe('Skill name.'),
    description: SkillDescriptionSchema,
    // Inline string (not NameSchema): named ResourceName + optional/describe emits OpenAPI allOf.
    display_name: z
      .string()
      .min(2)
      .max(64)
      .regex(
        /^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$/,
        'must be 2–64 lowercase chars: start with a letter, end with alphanumeric, optionally separated by ".", "_" or "-"',
      )
      .optional()
      .describe('Display name.'),
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

/** One version row for the TrueFoundry skill picker dropdown. */
export const SkillVersionSchema = z
  .object({
    id: z.string().min(1),
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

export type SkillType = z.infer<typeof SkillTypeSchema>;
export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type GitSkillManifest = z.infer<typeof GitSkillManifestSchema>;
export type RegistrySkillManifest = z.infer<typeof RegistrySkillManifestSchema>;
export type ConfiguredSkill = z.infer<typeof ConfiguredSkillSchema>;
export type CreateSkillRequest = z.infer<typeof CreateSkillRequestSchema>;
export type UpdateSkillRequest = z.infer<typeof UpdateSkillRequestSchema>;
export type AvailableSkill = z.infer<typeof AvailableSkillSchema>;
export type SkillVersion = z.infer<typeof SkillVersionSchema>;
