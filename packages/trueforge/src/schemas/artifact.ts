import { z } from '@hono/zod-openapi';
import { SubjectSchema, TokenPaginationSchema } from '@truefoundry/trueforge-core/agent-session';

export const ArtifactEntryContentTypeSchema = z.enum(['html', 'markdown']).openapi('ArtifactEntryContentType');
export const ArtifactStorageBackendSchema = z.enum(['local', 's3']).openapi('ArtifactStorageBackend');

export const ArtifactFileSchema = z
  .object({
    path: z.string().describe('Path inside the bundle, relative to the version root.'),
    size_bytes: z.number().int().nonnegative(),
    sha256: z.string(),
    media_type: z.string(),
  })
  .openapi('ArtifactFile');

const artifactVersionSummaryShape = {
  artifact_id: z.string(),
  version: z.number().int().positive(),
  note: z.string().nullable(),
  entry_path: z.string(),
  entry_content_type: ArtifactEntryContentTypeSchema,
  file_count: z.number().int().nonnegative(),
  total_size_bytes: z.number().int().nonnegative(),
  session_id: z.string(),
  turn_id: z.string(),
  source_root: z.string(),
  storage_backend: ArtifactStorageBackendSchema,
  created_by_subject: SubjectSchema,
  created_at: z.iso.datetime(),
};

export const ArtifactVersionSummarySchema = z.object(artifactVersionSummaryShape).openapi('ArtifactVersionSummary');

export const ArtifactVersionSchema = z
  .object({ ...artifactVersionSummaryShape, files: z.array(ArtifactFileSchema) })
  .openapi('ArtifactVersion');

export const ArtifactSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    url: z.string().describe('Absolute or path-absolute link that opens the artifact.'),
    latest_version: ArtifactVersionSummarySchema,
    created_by_subject: SubjectSchema,
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .openapi('Artifact');

export const GetArtifactResponseSchema = z.object({ data: ArtifactSchema }).openapi('GetArtifactResponse');
export const ListArtifactsResponseSchema = z
  .object({ data: z.array(ArtifactSchema), pagination: TokenPaginationSchema })
  .openapi('ListArtifactsResponse');
export const DeleteArtifactResponseSchema = z.object({}).openapi('DeleteArtifactResponse');
export const GetArtifactVersionResponseSchema = z
  .object({ data: ArtifactVersionSchema })
  .openapi('GetArtifactVersionResponse');
export const ListArtifactVersionsResponseSchema = z
  .object({ data: z.array(ArtifactVersionSchema), pagination: TokenPaginationSchema })
  .openapi('ListArtifactVersionsResponse');

export const ArtifactBundleSourceSchema = z
  .object({
    session_id: z.string().min(1).max(128),
    turn_id: z.string().min(1).max(128),
    entry_path: z.string().min(1).max(4095).describe('Absolute sandbox path of the HTML or Markdown file to publish.'),
  })
  .openapi('ArtifactBundleSource');

// Left unnamed: `.nullable()` on a named schema would make the shared component nullable.
const ArtifactBundleChangeSchema = z.object({
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
});

export const PreviewArtifactBundleRequestSchema = z
  .object({
    session_id: z.string().min(1).max(128),
    turn_id: z.string().min(1).max(128),
    entry_path: z.string().min(1).max(4095),
    artifact_id: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe('When set, the response includes a diff against this artifact.'),
  })
  .openapi('PreviewArtifactBundleRequest');

export const PreviewArtifactBundleFileSchema = z
  .object({
    path: z.string(),
    size_bytes: z.number().int().nonnegative(),
  })
  .openapi('PreviewArtifactBundleFile');

export const PreviewArtifactBundleSchema = z
  .object({
    root: z.string(),
    entry_path: z.string(),
    entry_content_type: ArtifactEntryContentTypeSchema,
    files: z.array(PreviewArtifactBundleFileSchema),
    missing: z.array(z.string()),
    total_size_bytes: z.number().int().nonnegative(),
    changes: ArtifactBundleChangeSchema.nullable(),
  })
  .openapi('PreviewArtifactBundle');

export const PreviewArtifactBundleResponseSchema = z
  .object({ data: PreviewArtifactBundleSchema })
  .openapi('PreviewArtifactBundleResponse');

export const CreateArtifactRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug: z.string().trim().min(1).max(64).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    source: ArtifactBundleSourceSchema,
  })
  .openapi('CreateArtifactRequest');

export const UpdateArtifactRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .openapi('UpdateArtifactRequest');

export const CreateArtifactVersionRequestSchema = z
  .object({
    note: z.string().trim().max(500).nullable().optional(),
    source: ArtifactBundleSourceSchema,
  })
  .openapi('CreateArtifactVersionRequest');

export const ArtifactContentTokenSchema = z
  .object({
    token: z.string(),
    base_url: z.string().describe('Prefix to load bundle files from. Append a bundle path.'),
    expires_at: z.iso.datetime(),
  })
  .openapi('ArtifactContentToken');

export const GetArtifactContentTokenResponseSchema = z
  .object({ data: ArtifactContentTokenSchema })
  .openapi('GetArtifactContentTokenResponse');

export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;
export type ArtifactVersionSummary = z.infer<typeof ArtifactVersionSummarySchema>;
