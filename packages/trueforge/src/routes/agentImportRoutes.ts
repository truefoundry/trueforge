/**
 * Ops import routes mounted at /api/internal/import.
 */
import { createRoute } from '@hono/zod-openapi';
import {
  ImportAgentsRequestSchema,
  ImportAgentsResponseSchema,
  ImportSessionRequestSchema,
  ImportSessionResponseSchema,
  ImportSessionsCheckpointQuerySchema,
  ImportSessionsCheckpointResponseSchema,
} from '../schemas/agentImport';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { OpenApiTag } from './openapiTags';

export const importAgentsRoute = createRoute({
  method: 'post',
  path: '/agents',
  tags: [OpenApiTag.INTERNAL],
  summary: 'Import agents in bulk (create)',
  description: 'Ops/backfill only. Per-item created | exists | failed.',
  'x-fern-ignore': true,
  request: {
    body: {
      content: { 'application/json': { schema: ImportAgentsRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ImportAgentsResponseSchema } },
      description: 'Per-agent create results.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid body.',
    },
  },
});

export const importSessionRoute = createRoute({
  method: 'post',
  path: '/sessions',
  tags: [OpenApiTag.INTERNAL],
  summary: 'Import one historical session snapshot',
  description:
    'Ops/backfill only. Named sessions link agent_name to a local agent when present; otherwise a dummy agent_id. Drafts use agent_spec (SF name/id stashed in metadata when both present). 409 if session_id exists.',
  'x-fern-ignore': true,
  request: {
    body: {
      content: { 'application/json': { schema: ImportSessionRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: ImportSessionResponseSchema } },
      description: 'Imported.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid body or non-importable session (e.g. missing agent_id for unresolved named agent).',
    },
    409: {
      content: { 'application/json': { schema: ImportSessionResponseSchema } },
      description: 'Session already exists.',
    },
    500: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Internal server error.',
    },
  },
});

export const getImportSessionsCheckpointRoute = createRoute({
  method: 'get',
  path: '/checkpoint',
  tags: [OpenApiTag.INTERNAL],
  summary: 'Session import checkpoint',
  description: 'Min created_at among imported sessions for one tenant (metadata.imported=true).',
  'x-fern-ignore': true,
  request: {
    query: ImportSessionsCheckpointQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ImportSessionsCheckpointResponseSchema } },
      description: 'Per-tenant checkpoint watermark.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid query.',
    },
    500: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Internal server error.',
    },
  },
});
