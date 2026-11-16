/**
 * Artifact route definitions (mounted at /api/v1/artifacts).
 * Handlers are registered in apis/artifacts.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import {
  CreateArtifactRequestSchema,
  CreateArtifactVersionRequestSchema,
  DeleteArtifactResponseSchema,
  GetArtifactContentTokenResponseSchema,
  GetArtifactResponseSchema,
  GetArtifactVersionResponseSchema,
  ListArtifactsResponseSchema,
  ListArtifactVersionsResponseSchema,
  PreviewArtifactBundleRequestSchema,
  PreviewArtifactBundleResponseSchema,
  UpdateArtifactRequestSchema,
} from '../schemas/artifact';
import { PAGE_LIMIT } from '../schemas/common';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { TOKEN_PAGINATION } from './fernExtensions';
import { OpenApiTag } from './openapiTags';

const errorResponses = {
  403: {
    content: { 'application/json': { schema: RequestErrorResponseSchema } },
    description: 'Caller cannot perform this action.',
  },
  404: {
    content: { 'application/json': { schema: RequestErrorResponseSchema } },
    description: 'Artifact was not found.',
  },
  409: {
    content: { 'application/json': { schema: RequestErrorResponseSchema } },
    description: 'Slug is taken, or the sandbox is unavailable.',
  },
  413: {
    content: { 'application/json': { schema: RequestErrorResponseSchema } },
    description: 'The bundle exceeds a size or file-count limit.',
  },
  422: {
    content: { 'application/json': { schema: RequestErrorResponseSchema } },
    description: 'Slug, path, or content type is not valid.',
  },
} as const;

export const ArtifactIdParamsSchema = z
  .object({ artifact_id: z.string().min(1).max(64).describe('Immutable artifact identifier.') })
  .openapi('ArtifactIdParams');

export const ArtifactVersionParamsSchema = z
  .object({
    artifact_id: z.string().min(1).max(64),
    version: z.coerce.number().int().positive(),
  })
  .openapi('ArtifactVersionParams');

export const ListArtifactsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(PAGE_LIMIT).optional().default(PAGE_LIMIT),
    page_token: z.string().optional(),
    slug: z.string().optional().describe('Exact slug match. Returns at most one artifact.'),
    session_id: z.string().optional().describe('Only artifacts that have a version from this session.'),
    created_by_me: z.stringbool().optional().openapi({ type: 'boolean' }),
    q: z.string().optional().describe('Case-insensitive match against the title or slug.'),
  })
  .openapi('ListArtifactsQuery');

export const ListArtifactVersionsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(PAGE_LIMIT).optional().default(PAGE_LIMIT),
    page_token: z.string().optional(),
  })
  .openapi('ListArtifactVersionsQuery');

const group = ['artifacts'] as const;

export const listArtifactsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'List artifacts',
  description: 'List artifacts in the tenant, newest first. Any signed-in user can list them.',
  'x-fern-sdk-group-name': group,
  'x-fern-sdk-method-name': 'list',
  'x-fern-pagination': TOKEN_PAGINATION,
  request: { query: ListArtifactsQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: ListArtifactsResponseSchema } },
      description: 'A page of artifacts.',
    },
  },
});

export const previewArtifactBundleRoute = createRoute({
  method: 'post',
  path: '/bundle-preview',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'Preview an artifact bundle',
  description: 'Resolve the files an entry page needs, without publishing. The caller must own the session.',
  'x-fern-sdk-group-name': group,
  'x-fern-sdk-method-name': 'preview_bundle',
  request: {
    body: { content: { 'application/json': { schema: PreviewArtifactBundleRequestSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PreviewArtifactBundleResponseSchema } },
      description: 'Files that would be published.',
    },
    ...errorResponses,
  },
});

export const createArtifactRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'Publish an artifact',
  description: 'Copy a sandbox HTML or Markdown file and the files it needs into durable storage.',
  'x-fern-sdk-group-name': group,
  'x-fern-sdk-method-name': 'create',
  request: { body: { content: { 'application/json': { schema: CreateArtifactRequestSchema } }, required: true } },
  responses: {
    201: {
      content: { 'application/json': { schema: GetArtifactResponseSchema } },
      description: 'The published artifact.',
    },
    ...errorResponses,
  },
});

export const getArtifactRoute = createRoute({
  method: 'get',
  path: '/{artifact_id}',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'Get an artifact',
  description: 'Fetch one artifact, including its latest version and files.',
  'x-fern-sdk-group-name': group,
  'x-fern-sdk-method-name': 'get',
  request: { params: ArtifactIdParamsSchema },
  responses: {
    200: { content: { 'application/json': { schema: GetArtifactResponseSchema } }, description: 'The artifact.' },
    404: errorResponses[404],
  },
});

export const updateArtifactRoute = createRoute({
  method: 'put',
  path: '/{artifact_id}',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'Update artifact details',
  description: 'Replace the title and description. The creator or a tenant admin may update.',
  'x-fern-sdk-group-name': group,
  'x-fern-sdk-method-name': 'update',
  request: {
    params: ArtifactIdParamsSchema,
    body: { content: { 'application/json': { schema: UpdateArtifactRequestSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetArtifactResponseSchema } },
      description: 'The updated artifact.',
    },
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

export const deleteArtifactRoute = createRoute({
  method: 'delete',
  path: '/{artifact_id}',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'Delete an artifact',
  description: 'Delete an artifact and its versions. The slug can be reused. The creator or a tenant admin may delete.',
  'x-fern-sdk-group-name': group,
  'x-fern-sdk-method-name': 'delete',
  request: { params: ArtifactIdParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: DeleteArtifactResponseSchema } },
      description: 'The artifact was deleted.',
    },
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

export const listArtifactVersionsRoute = createRoute({
  method: 'get',
  path: '/{artifact_id}/versions',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'List artifact versions',
  description: 'List versions of an artifact, newest first.',
  'x-fern-sdk-group-name': group,
  'x-fern-sdk-method-name': 'list_versions',
  'x-fern-pagination': TOKEN_PAGINATION,
  request: { params: ArtifactIdParamsSchema, query: ListArtifactVersionsQuerySchema },
  responses: {
    200: {
      content: { 'application/json': { schema: ListArtifactVersionsResponseSchema } },
      description: 'A page of versions.',
    },
    404: errorResponses[404],
  },
});

export const createArtifactVersionRoute = createRoute({
  method: 'post',
  path: '/{artifact_id}/versions',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'Publish an artifact version',
  description: 'Publish a new immutable version. An unchanged bundle returns the current version.',
  'x-fern-sdk-group-name': group,
  'x-fern-sdk-method-name': 'create_version',
  request: {
    params: ArtifactIdParamsSchema,
    body: { content: { 'application/json': { schema: CreateArtifactVersionRequestSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetArtifactVersionResponseSchema } },
      description: 'The existing version; the bundle was unchanged.',
    },
    201: {
      content: { 'application/json': { schema: GetArtifactVersionResponseSchema } },
      description: 'The new version.',
    },
    ...errorResponses,
  },
});

export const getArtifactVersionRoute = createRoute({
  method: 'get',
  path: '/{artifact_id}/versions/{version}',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'Get an artifact version',
  description: 'Fetch one version, including its files.',
  'x-fern-sdk-group-name': group,
  'x-fern-sdk-method-name': 'get_version',
  request: { params: ArtifactVersionParamsSchema },
  responses: {
    200: { content: { 'application/json': { schema: GetArtifactVersionResponseSchema } }, description: 'The version.' },
    404: errorResponses[404],
  },
});

export const getArtifactContentTokenRoute = createRoute({
  method: 'get',
  path: '/{artifact_id}/versions/{version}/content-token',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'Get an artifact content token',
  description: 'Mint a short-lived token used to load the version files in the viewer.',
  'x-fern-sdk-group-name': group,
  'x-fern-sdk-method-name': 'get_content_token',
  request: { params: ArtifactVersionParamsSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: GetArtifactContentTokenResponseSchema } },
      description: 'A token and the URL prefix for the version.',
    },
    404: errorResponses[404],
  },
});

export const downloadArtifactVersionRoute = createRoute({
  method: 'get',
  path: '/{artifact_id}/versions/{version}/download',
  tags: [OpenApiTag.ARTIFACTS],
  summary: 'Download an artifact version',
  description: 'Download a single file, or a zip when the version contains more than one file.',
  'x-fern-sdk-group-name': group,
  'x-fern-sdk-method-name': 'download_version',
  request: { params: ArtifactVersionParamsSchema },
  responses: {
    200: {
      content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } },
      description: 'The file, or a zip of the bundle.',
    },
    404: errorResponses[404],
  },
});
