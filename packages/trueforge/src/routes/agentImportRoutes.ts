/**
 * Ops bulk agent import (mounted at /api/internal/import).
 * Creates each agent; per-item created | exists | failed (no whole-request 409).
 */
import { createRoute } from '@hono/zod-openapi';
import { ImportAgentsRequestSchema, ImportAgentsResponseSchema } from '../schemas/agentImport';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { OpenApiTag } from './openapiTags';

export const importAgentsRoute = createRoute({
  method: 'post',
  path: '/agents',
  tags: [OpenApiTag.INTERNAL],
  summary: 'Import agents in bulk (create)',
  description:
    'Ops/backfill only. Creates each agent under its tenant_id with created_by_subject. Name conflicts are reported per item as exists.',
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
