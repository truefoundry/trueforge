/**
 * Sandbox environment route definitions (mounted at /api/v1/sandbox-environments).
 * Handlers are registered in apis/sandboxEnvironments.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { PAGE_LIMIT } from '../schemas/common';
import { RequestErrorResponseSchema } from '../schemas/errors';
import {
  CreateSandboxEnvironmentRequestSchema,
  DeleteSandboxEnvironmentResponseSchema,
  GetSandboxEnvironmentResponseSchema,
  ListSandboxEnvironmentsResponseSchema,
  UpdateSandboxEnvironmentRequestSchema,
} from '../schemas/sandboxEnvironment';
import { TOKEN_PAGINATION } from './fernExtensions';
import { OpenApiTag } from './openapiTags';

export const SandboxEnvironmentIdParamsSchema = z.object({
  sandbox_environment_id: z.string().min(1).max(64).describe('Immutable sandbox environment identifier.'),
});

export const ListSandboxEnvironmentsQuerySchema = z
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
  })
  .openapi('ListSandboxEnvironmentsQuery');

export const listSandboxEnvironmentsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.SANDBOXES],
  summary: 'List sandbox environments',
  description: 'List sandbox environments created by the authenticated subject, newest first.',
  'x-fern-sdk-group-name': ['sandbox_environments'],
  'x-fern-sdk-method-name': 'list',
  'x-fern-pagination': TOKEN_PAGINATION,
  request: {
    query: ListSandboxEnvironmentsQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListSandboxEnvironmentsResponseSchema } },
      description: 'Paginated caller-owned sandbox environments.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid query parameters or page token.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unauthenticated.',
    },
  },
});

export const createSandboxEnvironmentRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [OpenApiTag.SANDBOXES],
  summary: 'Create a sandbox environment',
  description: 'Create a Daytona sandbox environment owned by the authenticated subject.',
  'x-fern-sdk-group-name': ['sandbox_environments'],
  'x-fern-sdk-method-name': 'create',
  request: {
    body: {
      content: { 'application/json': { schema: CreateSandboxEnvironmentRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: GetSandboxEnvironmentResponseSchema } },
      description: 'Created sandbox environment.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unauthenticated.',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Name already exists in the tenant.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Provider, snapshot, or secret validation failed.',
    },
  },
});

export const getSandboxEnvironmentRoute = createRoute({
  method: 'get',
  path: '/{sandbox_environment_id}',
  tags: [OpenApiTag.SANDBOXES],
  summary: 'Get a sandbox environment',
  description: 'Get a sandbox environment owned by the authenticated subject.',
  'x-fern-sdk-group-name': ['sandbox_environments'],
  'x-fern-sdk-method-name': 'get',
  request: {
    params: SandboxEnvironmentIdParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetSandboxEnvironmentResponseSchema } },
      description: 'The sandbox environment.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unauthenticated.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Not found or you do not have access.',
    },
  },
});

export const putSandboxEnvironmentRoute = createRoute({
  method: 'put',
  path: '/{sandbox_environment_id}',
  tags: [OpenApiTag.SANDBOXES],
  summary: 'Update a sandbox environment',
  description: 'Replace the manifest (and optionally description). Name is immutable.',
  'x-fern-sdk-group-name': ['sandbox_environments'],
  'x-fern-sdk-method-name': 'update',
  request: {
    params: SandboxEnvironmentIdParamsSchema,
    body: {
      content: { 'application/json': { schema: UpdateSandboxEnvironmentRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetSandboxEnvironmentResponseSchema } },
      description: 'Updated sandbox environment.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unauthenticated.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Not found or you do not have access.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Provider, snapshot, or secret validation failed.',
    },
  },
});

export const deleteSandboxEnvironmentRoute = createRoute({
  method: 'delete',
  path: '/{sandbox_environment_id}',
  tags: [OpenApiTag.SANDBOXES],
  summary: 'Delete a sandbox environment',
  description: 'Delete a caller-owned sandbox environment. Fails if any agent references it.',
  'x-fern-sdk-group-name': ['sandbox_environments'],
  'x-fern-sdk-method-name': 'delete',
  request: {
    params: SandboxEnvironmentIdParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: DeleteSandboxEnvironmentResponseSchema } },
      description: 'Deleted.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unauthenticated.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Not found or you do not have access.',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Environment is referenced by one or more agents.',
    },
  },
});
