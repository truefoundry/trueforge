/**
 * Turn route definitions (mounted at /v1/sessions). Creating a turn responds
 * with a Server-Sent Events stream; a running turn can be re-subscribed to
 * with resume support. Handlers are registered in apis/turns.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { TurnStreamingEventSchema } from '../schemas/events';
import {
  CreateTurnRequestSchema,
  GetTurnResponseSchema,
  ListTurnEventsRequestQuerySchema,
  ListTurnEventsResponseSchema,
  ListTurnsRequestQuerySchema,
  ListTurnsResponseSchema,
  SubscribeTurnRequestSchema,
} from '../schemas/turn';
import { SessionIdParamsSchema } from './sessionRoutes';

const SESSIONS_TAG = 'Sessions';

export const TurnIdParamsSchema = SessionIdParamsSchema.extend({
  turnId: z.string().min(1).describe('Turn identifier.'),
});

export const listTurnsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/turns',
  tags: [SESSIONS_TAG],
  summary: 'List turns in a session',
  description: 'List turns for a session (newest first by default), token-paginated.',
  request: {
    params: SessionIdParamsSchema,
    query: ListTurnsRequestQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListTurnsResponseSchema } },
      description: 'Paginated turns.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid page token.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session not found.',
    },
  },
});

export const getTurnRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/turns/{turnId}',
  tags: [SESSIONS_TAG],
  summary: 'Get a turn',
  description: 'Fetch a single turn by ID.',
  request: {
    params: TurnIdParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetTurnResponseSchema } },
      description: 'Turn data.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session or turn not found.',
    },
  },
});

export const listTurnEventsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/turns/{turnId}/events',
  tags: [SESSIONS_TAG],
  summary: 'List turn events',
  description: 'Paginated persisted events for a turn (insertion order by default).',
  request: {
    params: TurnIdParamsSchema,
    query: ListTurnEventsRequestQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListTurnEventsResponseSchema } },
      description: 'Paginated turn events.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid page token.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session or turn not found.',
    },
  },
});

export const createAndExecuteTurnRoute = createRoute({
  method: 'post',
  path: '/{sessionId}/turns',
  tags: [SESSIONS_TAG],
  summary: 'Create and execute a turn in a session',
  description: `Create a turn within a session and stream its execution as Server-Sent Events.
Use \`previous_turn_id\` to chain to the session's last turn (defaults to \`auto\`).`,
  request: {
    params: SessionIdParamsSchema,
    body: {
      content: { 'application/json': { schema: CreateTurnRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'text/event-stream': {
          schema: TurnStreamingEventSchema,
        },
      },
      description: 'Server-Sent Events stream of turn events.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session or prior turn not found.',
    },
    412: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Requested action cannot be performed on the session because it is no longer usable.',
    },
  },
});

export const subscribeTurnRoute = createRoute({
  method: 'post',
  path: '/{sessionId}/turns/{turnId}/subscribe',
  tags: [SESSIONS_TAG],
  summary: 'Subscribe to a running turn',
  description:
    'Subscribe to the live SSE stream for a turn. Pass `after_sequence_number` to resume after a disconnect (exclusive — events after this sequence number are replayed).',
  request: {
    params: TurnIdParamsSchema,
    body: {
      content: { 'application/json': { schema: SubscribeTurnRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'text/event-stream': {
          schema: TurnStreamingEventSchema,
        },
      },
      description: 'Server-Sent Events stream of turn events (deltas and lifecycle).',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Turn not found.',
    },
    412: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Cannot subscribe — the live stream no longer exists.',
    },
  },
});
