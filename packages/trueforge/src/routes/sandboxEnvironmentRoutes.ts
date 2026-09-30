/**
 * Sandbox environment route definitions (mounted at /api/v1/sandbox-environments).
 * Handlers are registered in apis/sandboxEnvironments.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { NameSchema, PAGE_LIMIT } from '../schemas/common';
import { RequestErrorResponseSchema } from '../schemas/errors';
import {
  DeleteSandboxEnvironmentResponseSchema,
  GetSandboxEnvironmentResponseSchema,
  ListSandboxEnvironmentsResponseSchema,
  UpdateSandboxEnvironmentRequestSchema,
} from '../schemas/sandboxEnvironment';
import { TOKEN_PAGINATION } from './fernExtensions';
import { OpenApiTag } from './openapiTags';

const SandboxEnvironmentNameParamsSchema = z.object({
  name: NameSchema.describe('Sandbox environment name.'),
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
  'x-fern-sdk-group-name': ['sandboxEnvironments'],
  'x-fern-sdk-method-name': 'list',
  'x-fern-pagination': TOKEN_PAGINATION,
  request: {
    query: ListSandboxEnvironmentsQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListSandboxEnvironmentsResponseSchema } },
      description: 'Paginated sandbox environments.',
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

export const getSandboxEnvironmentRoute = createRoute({
  method: 'get',
  path: '/{name}',
  tags: [OpenApiTag.SANDBOXES],
  summary: 'Get a sandbox environment',
  description: 'Get a sandbox environment by name for the authenticated subject.',
  'x-fern-sdk-group-name': ['sandboxEnvironments'],
  'x-fern-sdk-method-name': 'get',
  request: {
    params: SandboxEnvironmentNameParamsSchema,
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
      description: 'Sandbox environment not found.',
    },
  },
});

export const putSandboxEnvironmentRoute = createRoute({
  method: 'put',
  path: '/',
  tags: [OpenApiTag.SANDBOXES],
  summary: 'Create or update a sandbox environment',
  description: 'Create or replace by `manifest.name`. Requires a Daytona sandbox provider.',
  'x-fern-sdk-group-name': ['sandboxEnvironments'],
  'x-fern-sdk-method-name': 'create_or_update',
  request: {
    body: {
      content: { 'application/json': { schema: UpdateSandboxEnvironmentRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetSandboxEnvironmentResponseSchema } },
      description: 'The saved sandbox environment.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body, or missing secret value.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unauthenticated.',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Name conflict or concurrent update.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'No Daytona sandbox provider configured.',
    },
  },
});

export const deleteSandboxEnvironmentRoute = createRoute({
  method: 'delete',
  path: '/{name}',
  tags: [OpenApiTag.SANDBOXES],
  summary: 'Delete a sandbox environment',
  description: 'Delete by name. Fails if any agent still references the environment.',
  'x-fern-sdk-group-name': ['sandboxEnvironments'],
  'x-fern-sdk-method-name': 'delete',
  request: {
    params: SandboxEnvironmentNameParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: DeleteSandboxEnvironmentResponseSchema } },
      description: 'Sandbox environment deleted.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unauthenticated.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Sandbox environment not found.',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Environment is referenced by one or more agents.',
    },
  },
});
