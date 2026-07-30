/**
 * Session route definitions (mounted at /api/v1/sessions). A session holds an
 * inline agent spec. Handlers are registered in apis/sessions.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { ListSessionEventsRequestQuerySchema, ListSessionEventsResponseSchema } from '../schemas/events';
import {
  CreateSessionRequestSchema,
  GetSessionResponseSchema,
  ListSessionsRequestQuerySchema,
  ListSessionsResponseSchema,
  UpdateSessionRequestSchema,
} from '../schemas/session';
import { CancelSessionRequestSchema, CancelSessionResponseSchema } from '../schemas/turn';
import { TOKEN_PAGINATION } from './fernExtensions';

const SESSIONS_TAG = 'Sessions';

export const SessionIdParamsSchema = z.object({
  sessionId: z.string().min(1).max(64).describe('Session identifier.'),
});

export const createSessionRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [SESSIONS_TAG],
  summary: 'Create a session',
  description: 'Create a session holding an inline agent spec. Turns are executed against this spec.',
  'x-fern-sdk-group-name': ['sessions'],
  'x-fern-sdk-method-name': 'create',
  request: {
    body: {
      content: { 'application/json': { schema: CreateSessionRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: GetSessionResponseSchema } },
      description: 'Session created.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description:
        'The agent spec is valid but requires a capability this server does not provide (e.g. sandbox or skills).',
    },
  },
});

export const getSessionRoute = createRoute({
  method: 'get',
  path: '/{sessionId}',
  tags: [SESSIONS_TAG],
  summary: 'Get a session',
  description: 'Fetch a session by ID.',
  'x-fern-sdk-group-name': ['sessions'],
  'x-fern-sdk-method-name': 'get',
  request: {
    params: SessionIdParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetSessionResponseSchema } },
      description: 'Session data.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session not found.',
    },
  },
});

export const updateSessionRoute = createRoute({
  method: 'patch',
  path: '/{sessionId}',
  tags: [SESSIONS_TAG],
  summary: 'Update a session',
  description: "Update a session's inline agent spec. An empty body is a valid no-op that refreshes `updated_at`.",
  'x-fern-sdk-group-name': ['sessions'],
  'x-fern-sdk-method-name': 'update',
  request: {
    params: SessionIdParamsSchema,
    body: {
      content: { 'application/json': { schema: UpdateSessionRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetSessionResponseSchema } },
      description: 'Session updated.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session not found.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description:
        'The agent spec is valid but requires a capability this server does not provide (e.g. sandbox or skills).',
    },
  },
});

export const listSessionsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [SESSIONS_TAG],
  summary: 'List sessions',
  description:
    'List sessions (newest first by default), token-paginated. Pass `page_token` to fetch the next page, keeping the other query params constant.',
  'x-fern-sdk-group-name': ['sessions'],
  'x-fern-sdk-method-name': 'list',
  'x-fern-pagination': TOKEN_PAGINATION,
  request: {
    query: ListSessionsRequestQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListSessionsResponseSchema } },
      description: 'Paginated sessions.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid query parameters or page token.',
    },
  },
});

export const cancelSessionRoute = createRoute({
  method: 'post',
  path: '/{sessionId}/cancel',
  tags: [SESSIONS_TAG],
  summary: 'Cancel a running turn in a session',
  description: 'Cancel the running last turn for a session.',
  'x-fern-sdk-group-name': ['sessions'],
  'x-fern-sdk-method-name': 'cancel',
  request: {
    params: SessionIdParamsSchema,
    body: {
      content: { 'application/json': { schema: CancelSessionRequestSchema } },
      required: false,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CancelSessionResponseSchema } },
      description: 'Turn cancelled.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session not found.',
    },
    412: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description:
        'Requested action cannot be performed on the session because it is no longer usable, or the executor owning the running turn is unreachable.',
    },
  },
});

export const listSessionEventsRoute = createRoute({
  method: 'get',
  path: '/{sessionId}/events',
  tags: [SESSIONS_TAG],
  summary: 'List session events',
  description:
    'List session events as `{ turn_id, event }` across the active turn branch (newest first), including persisted events from a running tip. Each turn contributes turn.created, content events (model.message, tool.call, …), and turn.done when terminal; streaming deltas are not included. Use `page_token` to paginate backward toward older events while retaining the original branch anchor.',
  'x-fern-sdk-group-name': ['sessions'],
  'x-fern-sdk-method-name': 'list_events',
  'x-fern-pagination': TOKEN_PAGINATION,
  request: {
    params: SessionIdParamsSchema,
    query: ListSessionEventsRequestQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListSessionEventsResponseSchema } },
      description: 'Paginated session events.',
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
