import { z } from '@hono/zod-openapi';
import { SubjectSchema, TokenPaginationSchema } from '@truefoundry/trueforge-core/agent-session';
import { MAX_TITLE_LENGTH, PAGE_LIMIT } from './common';

export const ArtifactSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    latest_version: z.number().int().describe('Latest version.'),
    entry_point: z
      .string()
      .nullable()
      .describe(
        "Latest version's default file to render, as a path relative to the version. Null before the first version.",
      ),
    created_by_subject: SubjectSchema,
    created_by_session_id: z.string(),
    created_by_agent_id: z
      .string()
      .nullable()
      .describe('Registry agent of the creating session. Null when the session used an inline agent spec.'),
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
    name: z.string().trim().min(1).optional().describe('Case-insensitive substring match on artifact name.'),
  })
  .openapi('ListArtifactsRequestQuery');

export const ListArtifactsResponseSchema = z
  .object({
    data: z.array(ArtifactSchema),
    pagination: TokenPaginationSchema,
  })
  .openapi('ListArtifactsResponse');

export const GetArtifactResponseSchema = z.object({ data: ArtifactSchema }).openapi('GetArtifactResponse');

/** Control characters, bidi embeddings/overrides/isolates, and characters disallowed in file names. */
const FORBIDDEN_ARTIFACT_NAME_CHARACTERS = /[\p{Cc}\u202A-\u202E\u2066-\u2069/\\:*?"<>|]/u;

/** Rejects forbidden characters, collapses whitespace (incl. line/paragraph separators) to one space, and trims. */
export const ArtifactNameSchema = z
  .string()
  .refine(name => !FORBIDDEN_ARTIFACT_NAME_CHARACTERS.test(name), {
    message: 'Artifact name must not contain control, bidi, or / \\ : * ? " < > | characters.',
  })
  .transform(name => name.replace(/\s+/gu, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'Artifact name must not be empty.')
      .max(MAX_TITLE_LENGTH, `Artifact name must be at most ${String(MAX_TITLE_LENGTH)} characters.`)
      .refine(name => !name.endsWith('.'), { message: 'Artifact name must not end with a dot.' }),
  );

export const UpdateArtifactRequestSchema = z
  .object({
    name: ArtifactNameSchema.describe(
      `New artifact name, 1-${String(MAX_TITLE_LENGTH)} characters. Control, bidi, and / \\ : * ? " < > | characters are rejected; a trailing dot is not allowed.`,
    ),
  })
  .strict()
  .openapi('UpdateArtifactRequest');
