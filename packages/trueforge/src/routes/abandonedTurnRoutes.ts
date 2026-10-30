/**
 * Internal abandoned-turn closer routes (API-key auth).
 * Mounted at /api/internal/turns.
 */
import { createRoute } from '@hono/zod-openapi';
import { CloseAbandonedTurnRequestSchema, ListAbandonedTurnsResponseSchema } from '../schemas/abandonedTurn';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { OpenApiTag } from './openapiTags';

export const listAbandonedTurnsRoute = createRoute({
  method: 'get',
  path: '/abandoned',
  tags: [OpenApiTag.INTERNAL],
  summary: 'List abandoned running turns',
  description: 'Returns all running turns whose last activity is past the stale threshold.',
  'x-fern-sdk-group-name': ['internal', 'turns'],
  'x-fern-sdk-method-name': 'list_abandoned',
  'x-excluded': true,
  responses: {
    200: {
      content: { 'application/json': { schema: ListAbandonedTurnsResponseSchema } },
      description: 'Stale running turns oldest-first.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid service credential.',
    },
  },
});

export const closeAbandonedTurnRoute = createRoute({
  method: 'post',
  path: '/close-abandoned',
  tags: [OpenApiTag.INTERNAL],
  summary: 'Close an abandoned running turn',
  description: 'Cancels a stale running turn (turn.done with abandoned reason).',
  'x-fern-sdk-group-name': ['internal', 'turns'],
  'x-fern-sdk-method-name': 'close_abandoned',
  'x-excluded': true,
  request: {
    body: {
      content: { 'application/json': { schema: CloseAbandonedTurnRequestSchema } },
      required: true,
    },
  },
  responses: {
    204: { description: 'Closed (or already terminal / missing turn).' },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid service credential.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session not found.',
    },
  },
});
