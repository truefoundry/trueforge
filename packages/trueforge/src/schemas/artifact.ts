import { z } from '@hono/zod-openapi';
import { SubjectSchema, TokenPaginationSchema } from '@truefoundry/trueforge-core/agent-session';
import { IsoTimestampQueryParam, PAGE_LIMIT } from './common';

export const ArtifactSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    latest_version: z.number().int().describe('Highest committed version; 0 before the first commit.'),
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
    last_updated_from: IsoTimestampQueryParam.optional().describe(
      'Inclusive lower bound on `updated_at` (ISO-8601 / RFC 3339). Cannot be combined with `created_from` or `created_to`.',
    ),
    last_updated_to: IsoTimestampQueryParam.optional().describe(
      'Inclusive upper bound on `updated_at` (ISO-8601 / RFC 3339). Cannot be combined with `created_from` or `created_to`.',
    ),
    created_from: IsoTimestampQueryParam.optional().describe(
      'Inclusive lower bound on `created_at` (ISO-8601 / RFC 3339). Cannot be combined with `last_updated_from` or `last_updated_to`.',
    ),
    created_to: IsoTimestampQueryParam.optional().describe(
      'Inclusive upper bound on `created_at` (ISO-8601 / RFC 3339). Cannot be combined with `last_updated_from` or `last_updated_to`.',
    ),
  })
  .refine(
    q =>
      (q.last_updated_from === undefined && q.last_updated_to === undefined) ||
      (q.created_from === undefined && q.created_to === undefined),
    { message: 'Pass only one of the last_updated or created time ranges.' },
  )
  .openapi('ListArtifactsRequestQuery');

export const ListArtifactsResponseSchema = z
  .object({
    data: z.array(ArtifactSchema),
    pagination: TokenPaginationSchema,
  })
  .openapi('ListArtifactsResponse');
