import { z } from '@hono/zod-openapi';
import { SubjectSchema, TokenPaginationSchema } from '@truefoundry/trueforge-core/agent-session';
import { PAGE_LIMIT } from './common';

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

/** `artifact_version.files_metadata` jsonb only — not on wire responses. */
export const ArtifactFilesMetadataSchema = z
  .object({
    entry_point: z.string().describe('Default file to render, relative to the version files.'),
    total_bytes: z.number().int().nonnegative(),
    root_path: z.string().describe('Storage location of the files; key prefix in case of S3.'),
  })
  .strict();

export type ArtifactFilesMetadata = z.infer<typeof ArtifactFilesMetadataSchema>;
