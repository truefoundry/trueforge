/**
 * Ops session import route (mounted at /api/v1/settings/sessions/import).
 */
import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { ImportSessionSnapshotRequestSchema, ImportSessionSnapshotResponseSchema } from '../schemas/sessionImport';
import { OpenApiTag } from './openapiTags';

export const importSessionSnapshotRoute = createRoute({
  method: 'post',
  path: '/import',
  tags: [OpenApiTag.AGENT_SESSIONS],
  summary: 'Import one historical session snapshot',
  description: 'Ops/backfill only. Skip if session_id exists; else insert in one transaction.',
  'x-fern-ignore': true,
  request: {
    body: {
      content: { 'application/json': { schema: ImportSessionSnapshotRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ImportSessionSnapshotResponseSchema } },
      description: 'Skipped — already exists.',
    },
    201: {
      content: { 'application/json': { schema: ImportSessionSnapshotResponseSchema } },
      description: 'Imported.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid body.',
    },
    501: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Import requires Postgres (not available in standalone).',
    },
  },
});
