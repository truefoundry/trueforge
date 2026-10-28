/**
 * Sandbox environment route definitions (mounted at /api/v1/sandbox-environments).
 * Handlers are registered in apis/sandboxEnvironments.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { NameSchema, PAGE_LIMIT } from '../schemas/common';
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

const SANDBOX_ENVIRONMENTS_PAGE_LIMIT = 1000;

const SandboxEnvironmentNameParamsSchema = z.object({
  name: NameSchema.describe('Sandbox environment name.'),
});

export const ListSandboxEnvironmentsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(SANDBOX_ENVIRONMENTS_PAGE_LIMIT)
      .optional()
      .default(PAGE_LIMIT)
      .describe(`Page size. Defaults to ${String(PAGE_LIMIT)}, max ${String(SANDBOX_ENVIRONMENTS_PAGE_LIMIT)}.`),
    page_token: z.string().optional().describe('Opaque token from a previous response `next_page_token`.'),
  })
  .openapi('ListSandboxEnvironmentsQuery');

export const listSandboxEnvironmentsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.SANDBOXES],
  summary: 'List sandbox environments',
  description: 'List available sandbox environments',
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

export const createSandboxEnvironmentRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [OpenApiTag.SANDBOXES],
  summary: 'Create a sandbox environment',
  description:
    'Creates by `manifest.name`. Fails if the name is already taken. Requires a configured sandbox provider.',
  'x-fern-sdk-group-name': ['sandboxEnvironments'],
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
      description: 'The created sandbox environment.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body, resource allocation, or missing secret value.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unauthenticated.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'User does not have permission to edit Sandbox environment',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'A sandbox environment with this name already exists.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Sandbox provider is missing, credentials are invalid, or rejected the secret.',
    },
    502: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Sandbox provider secret synchronization failed.',
    },
  },
});

export const putSandboxEnvironmentRoute = createRoute({
  method: 'put',
  path: '/',
  tags: [OpenApiTag.SANDBOXES],
  summary: 'Create or update a sandbox environment',
  description: 'Create a new sandbox environment or update an existing one.',
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
      description: 'Invalid request body, resource allocation, or missing secret value.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unauthenticated.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'User does not have permission to edit Sandbox environment',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Sandbox environment not found.',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Name conflict or concurrent update.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Sandbox provider is missing, credentials are invalid, or rejected the secret.',
    },
    502: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Sandbox provider secret synchronization failed.',
    },
  },
});

export const deleteSandboxEnvironmentRoute = createRoute({
  method: 'delete',
  path: '/{name}',
  tags: [OpenApiTag.SANDBOXES],
  summary: 'Delete a sandbox environment',
  description: 'Delete a sandbox environment, fails if any agent still references it.',
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
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'User does not have permission to edit Sandbox environment',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Sandbox environment not found or not owned by the caller.',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Environment is referenced by one or more agents.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Sandbox provider is missing, credentials are invalid, or rejected secret deletion.',
    },
    502: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Sandbox provider secret deletion failed.',
    },
  },
});
