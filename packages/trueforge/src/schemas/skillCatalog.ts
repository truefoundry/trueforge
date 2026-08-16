/**
 * Shipped skill-catalog.yaml schemas (discovery presets). Separate from
 * configured skill manifests in skill.ts.
 */
import { z } from '@hono/zod-openapi';
import { NameSchema, uniqueNames } from './common';
import {
  SkillDescriptionSchema,
  SkillGitPathSchema,
  SkillGitRefSchema,
  SkillGitUrlSchema,
  SkillTypeSchema,
} from './skill';

/** Catalog entry — discovery preset the settings UI copies into a PUT body. */
export const CatalogSkillSchema = z
  .object({
    type: SkillTypeSchema,
    name: NameSchema,
    url: SkillGitUrlSchema,
    path: SkillGitPathSchema.optional(),
    ref: SkillGitRefSchema,
    description: SkillDescriptionSchema,
  })
  .strict()
  .openapi('CatalogSkill');

export const SkillCatalogFileSchema = z
  .object({
    skills: z.array(CatalogSkillSchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    uniqueNames(file.skills, ctx);
  });

export const GetSkillCatalogResponseSchema = z
  .object({
    data: z.array(CatalogSkillSchema),
  })
  .openapi('GetSkillCatalogResponse');

export type CatalogSkill = z.infer<typeof CatalogSkillSchema>;
export type SkillCatalogFile = z.infer<typeof SkillCatalogFileSchema>;
