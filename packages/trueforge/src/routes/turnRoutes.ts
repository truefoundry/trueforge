/**
 * Turn route definitions.
 * DB-backed routes mount at /api/v1/sessions.
 * Handlers are registered in apis/turns.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { TurnStreamingEventSchema } from '../schemas/events';
import {
  CreateTurnRequestSchema,
  DownloadSandboxFileRequestQuerySchema,
  GetTurnResponseSchema,
  ListTurnEventsRequestQuerySchema,
  ListTurnEventsResponseSchema,
  ListTurnsRequestQuerySchema,
  ListTurnsResponseSchema,
  SubscribeTurnQuerySchema,
} from '../schemas/turn';
import { TOKEN_PAGINATION } from './fernExtensions';
import { OpenApiTag } from './openapiTags';
import { SessionIdParamsSchema } from './sessionRoutes';

export const TurnIdParamsSchema = SessionIdParamsSchema.extend({
  turn_id: z.string().min(1).describe('Turn identifier.'),
});

export const listTurnsRoute = createRoute({
  method: 'get',
  path: '/{session_id}/turns',
  tags: [OpenApiTag.AGENT_SESSIONS],
  summary: 'List turns in a session',
  description:
    'List turns for a session (newest first by default), token-paginated. Only the session creator may list turns.',
  'x-fern-sdk-group-name': ['sessions'],
  'x-fern-sdk-method-name': 'list_turns',
  'x-fern-pagination': TOKEN_PAGINATION,
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

export const getTurnRoute = createRoute({
  method: 'get',
  path: '/{session_id}/turns/{turn_id}',
  tags: [OpenApiTag.AGENT_SESSIONS],
  summary: 'Get a turn',
  description: 'Fetch a single turn by ID. Only the session creator may fetch it.',
  'x-fern-sdk-group-name': ['sessions'],
  'x-fern-sdk-method-name': 'get_turn',
  request: {
    params: TurnIdParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetTurnResponseSchema } },
      description: 'Turn data.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Caller is not the session creator.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session or turn not found.',
    },
  },
});

export const downloadSandboxFileRoute = createRoute({
  method: 'get',
  path: '/{session_id}/turns/{turn_id}/download-sandbox-file',
  tags: [OpenApiTag.AGENT_SESSIONS],
  summary: 'Download a file from the turn sandbox',
  description:
    "Download a file from the sandbox this turn ran in. Paths come from the assistant's `sandbox_artifacts` block. Only the session creator may download.",
  'x-fern-sdk-group-name': ['sessions'],
  'x-fern-sdk-method-name': 'download_sandbox_file',
  request: {
    params: TurnIdParamsSchema,
    query: DownloadSandboxFileRequestQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } },
      description: 'File contents.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid path, or the path is a directory.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Caller is not the session creator.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session, turn, or file not found.',
    },
    410: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Sandbox no longer exists.',
    },
    412: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Turn has no sandbox, or no sandbox provider is configured.',
    },
    413: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'File exceeds the maximum download size.',
    },
    424: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Sandbox infrastructure error.',
    },
  },
});

export const listTurnEventsRoute = createRoute({
  method: 'get',
  path: '/{session_id}/turns/{turn_id}/events',
  tags: [OpenApiTag.AGENT_SESSIONS],
  summary: 'List turn events',
  description:
    'Paginated persisted events for a turn (insertion order by default). Only the session creator may list events.',
  'x-fern-sdk-group-name': ['sessions'],
  'x-fern-sdk-method-name': 'list_turn_events',
  'x-fern-pagination': TOKEN_PAGINATION,
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
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Caller is not the session creator.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session or turn not found.',
    },
  },
});

export const createAndExecuteTurnRoute = createRoute({
  method: 'post',
  path: '/{session_id}/turns',
  tags: [OpenApiTag.AGENT_SESSIONS],
  summary: 'Create and execute a turn in a session',
  description: `Create a turn within a session and execute it.
Only the session creator may create turns.
When \`stream\` is true (default), respond with a Server-Sent Events stream of turn events.
When \`stream\` is false, return the turn immediately with \`state.status: "running"\` while execution continues in the background; use get turn or subscribe to observe completion.
Use \`previous_turn_id\` to chain to the session's last turn (defaults to \`auto\`); use \`none\` for a new root.`,
  'x-fern-sdk-group-name': ['sessions'],
  'x-fern-sdk-method-name': 'create_turn',
  'x-fern-streaming': {
    format: 'sse',
    resumable: false,
    'stream-condition': '$request.stream',
    response: { $ref: '#/components/schemas/GetTurnResponse' },
    'response-stream': { $ref: '#/components/schemas/TurnStreamingEvent' },
  },
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
        'application/json': {
          schema: GetTurnResponseSchema,
        },
        'text/event-stream': {
          schema: TurnStreamingEventSchema,
        },
      },
      description:
        'When stream is false: the running turn. When stream is true: Server-Sent Events stream of turn events.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid Bearer token or auth cookie',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Caller is not the session creator.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Session or prior turn not found.',
    },
    412: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Requested action cannot be performed on the session because it is no longer usable.',
    },
    413: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Request body exceeds the configured maximum size (MAX_REQUEST_BODY_BYTES).',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description:
        'The request is well-formed but cannot be processed: a referenced resource is missing ' +
        '(named agent, model, MCP server, skill, or sandbox provider), sandbox is required but ' +
        'unavailable (e.g. file uploads), or the turn input conflicts with current state ' +
        '(e.g. unresolved tool calls or approvals, tool name collision).',
    },
  },
});

export const subscribeTurnRoute = createRoute({
  method: 'get',
  path: '/{session_id}/turns/{turn_id}/subscribe',
  tags: [OpenApiTag.AGENT_SESSIONS],
  summary: 'Subscribe to a running turn',
  description:
    'Subscribe to the live SSE stream for a turn. Only the session creator may subscribe. Pass `after_sequence_number` to resume after a disconnect (exclusive — events after this sequence number are replayed).',
  'x-fern-sdk-group-name': ['sessions'],
  'x-fern-sdk-method-name': 'subscribe_to_turn',
  'x-fern-streaming': { format: 'sse', resumable: true },
  request: {
    params: TurnIdParamsSchema,
    query: SubscribeTurnQuerySchema,
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
      description: 'Invalid query parameters.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Caller is not the session creator.',
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
