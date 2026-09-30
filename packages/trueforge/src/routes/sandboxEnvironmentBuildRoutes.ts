/**
 * Internal sandbox-environment build routes (API-key auth).
 * Mounted at /api/internal/sandbox-environments.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { OpenApiTag } from './openapiTags';

export const PendingSandboxEnvironmentVersionSchema = z
  .object({
    environment_version_id: z.string().min(1).describe('Version row id to progress.'),
  })
  .strict()
  .openapi('PendingSandboxEnvironmentVersion');

export const ListPendingSandboxEnvironmentVersionsResponseSchema = z
  .object({
    data: z.array(PendingSandboxEnvironmentVersionSchema),
  })
  .strict()
  .openapi('ListPendingSandboxEnvironmentVersionsResponse');

export const ProgressSandboxEnvironmentVersionRequestSchema = z
  .object({
    environment_version_id: z.string().min(1).describe('Version row id to progress.'),
  })
  .strict()
  .openapi('ProgressSandboxEnvironmentVersionRequest');

export const listPendingSandboxEnvironmentVersionsRoute = createRoute({
  method: 'get',
  path: '/pending',
  tags: [OpenApiTag.INTERNAL],
  summary: 'List pending sandbox environment versions',
  description: 'Returns pending environment versions for the build controller.',
  'x-fern-sdk-group-name': ['internal', 'sandbox_environments'],
  'x-fern-sdk-method-name': 'list_pending',
  'x-excluded': true,
  responses: {
    200: {
      content: { 'application/json': { schema: ListPendingSandboxEnvironmentVersionsResponseSchema } },
      description: 'Pending versions oldest-first.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid service credential.',
    },
  },
});

export const progressSandboxEnvironmentVersionRoute = createRoute({
  method: 'post',
  path: '/progress',
  tags: [OpenApiTag.INTERNAL],
  summary: 'Progress a pending sandbox environment version',
  description: 'Registers or polls the snapshot build and updates version status.',
  'x-fern-sdk-group-name': ['internal', 'sandbox_environments'],
  'x-fern-sdk-method-name': 'progress',
  'x-excluded': true,
  request: {
    body: {
      content: { 'application/json': { schema: ProgressSandboxEnvironmentVersionRequestSchema } },
      required: true,
    },
  },
  responses: {
    204: { description: 'Progressed (or left pending).' },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid service credential.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Version not found.',
    },
  },
});
