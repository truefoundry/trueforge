/**
 * Session route definitions.
 * DB-backed routes mount at /api/v1/sessions.
 * Handlers are registered in apis/sessions.ts.
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
import { OpenApiTag } from './openapiTags';

export const SessionIdParamsSchema = z.object({
  session_id: z.string().min(1).max(64).describe('Session identifier.'),
});

export const createSessionRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [OpenApiTag.AGENT_SESSIONS],
  summary: 'Create a session',
  description:
    'Create a session with `agent` as either `{ name }` (named registry binding) or `{ spec: AgentSpec }` (inline). Named sessions snapshot the agent name at create and resolve the live agent on each turn. Responses use `{ type: "reference", name, id }` or `{ type: "inline", spec }`.',
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
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Named agent not found.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description:
        'The agent spec is valid but references a resource this server does not provide (e.g. model, MCP server, skill, or sandbox).',
    },
  },
});

export const getSessionRoute = createRoute({
  method: 'get',
  path: '/{session_id}',
  tags: [OpenApiTag.AGENT_SESSIONS],
  summary: 'Get a session',
  description: 'Fetch a session by ID. Only the session creator (`created_by`) may fetch it.',
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
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Caller is not the session creator.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session not found.',
    },
  },
});

export const deleteSessionRoute = createRoute({
  method: 'delete',
  path: '/{session_id}',
  tags: [OpenApiTag.AGENT_SESSIONS],
  summary: 'Delete a session',
  description:
    'Delete a session and all related turns, events, and internal state. Only the session creator (`created_by`) may delete it. Idempotent if already gone.',
  'x-fern-sdk-group-name': ['sessions'],
  'x-fern-sdk-method-name': 'delete',
  request: {
    params: SessionIdParamsSchema,
  },
  responses: {
    204: {
      description: 'Session and all related data deleted.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Caller is not the session creator.',
    },
  },
});

export const updateSessionRoute = createRoute({
  method: 'patch',
  path: '/{session_id}',
  tags: [OpenApiTag.AGENT_SESSIONS],
  summary: 'Update a session',
  description:
    'Update a session by replacing `agent` with `{ spec: AgentSpec }`. Named (reference) sessions reject agent updates. An empty body is a valid no-op that refreshes `updated_at`. Only the session creator (`created_by`) may update it.',
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
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Caller is not the session creator.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session not found.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description:
        'Named session rejected an agent update, or the agent spec references a resource this server does not provide (e.g. model, MCP server, skill, or sandbox).',
    },
  },
});

export const listSessionsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.AGENT_SESSIONS],
  summary: 'List sessions',
  description:
    "List the caller's sessions (newest first by default), token-paginated. Results are scoped to the authenticated identity via the session store's `created_by` filter (not a client query param). Optional `agent_id` filters to sessions bound to that named agent. Pass `page_token` to fetch the next page, keeping the other query params constant.",
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
  path: '/{session_id}/cancel',
  tags: [OpenApiTag.AGENT_SESSIONS],
  summary: 'Cancel a running turn in a session',
  description: 'Cancel the running last turn for a session. Only the session creator (`created_by`) may cancel.',
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
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Caller is not the session creator.',
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
  path: '/{session_id}/events',
  tags: [OpenApiTag.AGENT_SESSIONS],
  summary: 'List session events',
  description:
    'List session events as `{ turn_id, event }` across the active turn branch (newest first), including persisted events from a running tip. Each turn contributes turn.created, content events (model.message, tool.call, …), and turn.done when terminal; streaming deltas are not included. Use `page_token` to paginate backward toward older events while retaining the original branch anchor. Only the session creator (`created_by`) may list events.',
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
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Caller is not the session creator.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session not found.',
    },
  },
});
