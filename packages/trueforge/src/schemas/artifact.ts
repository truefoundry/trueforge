import { z } from '@hono/zod-openapi';
import { SubjectSchema, TokenPaginationSchema } from '@truefoundry/trueforge-core/agent-session';
import { PAGE_LIMIT } from './common';

export const ArtifactSchema = z
  .object({
    slug: z.string(),
    title: z.string(),
    latest_version: z.number().int().describe('Latest version.'),
    created_by_subject: SubjectSchema,
    created_by_session_id: z.string(),
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
    created_by_session_id: z
      .string()
      .min(1)
      .optional()
      .describe('When set, only artifacts created in this session are returned.'),
    title: z.string().trim().min(1).optional().describe('Case-insensitive substring match on artifact title.'),
  })
  .openapi('ListArtifactsRequestQuery');

export const ListArtifactsResponseSchema = z
  .object({
    data: z.array(ArtifactSchema),
    pagination: TokenPaginationSchema,
  })
  .openapi('ListArtifactsResponse');
