import { z } from '@hono/zod-openapi';
import { SubjectSchema, TokenPaginationSchema } from '@truefoundry/trueforge-core/agent-session';
import { MAX_TITLE_LENGTH, PAGE_LIMIT } from './common';

export const ArtifactSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    created_by_subject: SubjectSchema,
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .strict()
  .openapi('Artifact');

export type Artifact = z.infer<typeof ArtifactSchema>;

export const ListArtifactsRequestQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PAGE_LIMIT)
      .optional()
      .default(PAGE_LIMIT)
      .describe(`Page size. Defaults to ${String(PAGE_LIMIT)}`),
    page_token: z.string().optional().describe('Opaque token from a previous response `next_page_token`.'),
    name: z.string().trim().min(1).optional().describe('Case-insensitive substring match on artifact name.'),
  })
  .openapi('ListArtifactsRequestQuery');

export const ListArtifactsResponseSchema = z
  .object({
    data: z.array(ArtifactSchema),
    pagination: TokenPaginationSchema,
  })
  .openapi('ListArtifactsResponse');

export const ListSessionArtifactsRequestQuerySchema = z
  .object({
    name: z.string().trim().min(1).optional().describe('Case-insensitive substring match on artifact name.'),
  })
  .openapi('ListSessionArtifactsRequestQuery');

export const ListSessionArtifactsResponseSchema = z
  .object({
    data: z.array(ArtifactSchema),
  })
  .openapi('ListSessionArtifactsResponse');

/** Excludes control characters, bidi embeddings/overrides/isolates, and characters disallowed in file names. */
// eslint-disable-next-line no-control-regex -- rejecting control characters is the intent
const ARTIFACT_NAME_PATTERN = /^[^\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069/\\:*?"<>|]*$/;

/** Validates the raw name, then collapses whitespace (incl. line/paragraph separators) to one space and trims. */
export const ArtifactNameSchema = z
  .string()
  .min(1)
  .max(MAX_TITLE_LENGTH)
  .regex(ARTIFACT_NAME_PATTERN, 'Must not contain control, bidi, or / \\ : * ? " < > | characters.')
  .transform(name => name.replace(/\s+/gu, ' ').trim())
  .refine(name => name.length > 0, 'Must not be blank.');

export const UpdateArtifactRequestSchema = z
  .object({
    name: ArtifactNameSchema.describe('New artifact name. Whitespace is collapsed and trimmed; must not be blank.'),
  })
  .strict()
  .openapi('UpdateArtifactRequest');

export const UpdateArtifactResponseSchema = z.object({ data: ArtifactSchema }).openapi('UpdateArtifactResponse');

/** `artifact_version.artifact_version_metadata` jsonb only — not on wire responses. */
export const ArtifactVersionMetadataSchema = z
  .object({
    entry_point: z.string().describe('Default file to render, relative to the version files.'),
    total_bytes: z.number().int().nonnegative(),
    storage_prefix: z.string().describe('Object-store key prefix holding the version files.'),
  })
  .strict();

export type ArtifactVersionMetadata = z.infer<typeof ArtifactVersionMetadataSchema>;
