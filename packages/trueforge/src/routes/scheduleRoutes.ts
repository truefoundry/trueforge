/**
 * Schedule route definitions (mounted at /api/v1/schedules).
 * Handlers are registered in apis/schedules.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { AgentNameSchema, PAGE_LIMIT, parseCommaSeparatedQuery } from '../schemas/common';
import { RequestErrorResponseSchema } from '../schemas/errors';
import {
  CreateScheduleRequestSchema,
  CreateScheduleRunRequestSchema,
  CreateScheduleRunResponseSchema,
  DeleteScheduleResponseSchema,
  GetScheduleResponseSchema,
  ListScheduleRunsResponseSchema,
  ListSchedulesResponseSchema,
  UpdateScheduleRequestSchema,
} from '../schemas/schedule';
import { TOKEN_PAGINATION } from './fernExtensions';
import { OpenApiTag } from './openapiTags';

export const ScheduleIdParamsSchema = z.object({
  schedule_id: z.string().min(1).max(64).describe('Immutable schedule identifier.'),
});

export const ListSchedulesQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PAGE_LIMIT)
      .optional()
      .default(PAGE_LIMIT)
      .describe(`Page size. Defaults to ${String(PAGE_LIMIT)}`),
    page_token: z.string().optional().describe('Opaque token from a previous response `next_page_token`.'),
    // comma-separated string -> array of names
    agent_names: z
      .string()
      .optional()
      .openapi({
        type: 'string',
        description: 'Filter by one or more agent names (comma-separated). When set, at least one name is required.',
      })
      .transform(value => parseCommaSeparatedQuery(value))
      .pipe(z.array(AgentNameSchema).min(1).optional()),
  })
  .openapi('ListSchedulesQuery');

export const listSchedulesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'List schedules',
  description: 'List schedules for the tenant, newest first. Optionally filter by `agent_names`.',
  'x-fern-sdk-group-name': ['schedules'],
  'x-fern-sdk-method-name': 'list',
  'x-fern-pagination': TOKEN_PAGINATION,
  request: {
    query: ListSchedulesQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListSchedulesResponseSchema } },
      description: 'Paginated matching schedules.',
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

export const listScheduleRunsRoute = createRoute({
  method: 'get',
  path: '/{schedule_id}/runs',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'List runs of a schedule',
  description:
    'List runs of a schedule, newest `scheduled_for` first. Only the schedule creator (or an admin) may list its runs.',
  'x-fern-sdk-group-name': ['schedules'],
  'x-fern-sdk-method-name': 'list_runs',
  request: {
    params: ScheduleIdParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListScheduleRunsResponseSchema } },
      description: 'Runs of the schedule.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The caller is not the schedule creator.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Not found.',
    },
  },
});

export const createScheduleRunRoute = createRoute({
  method: 'post',
  path: '/runs',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'Trigger a schedule run',
  description:
    'Start a schedule run immediately using the schedule task. Does not replace or advance the cron pending run.',
  'x-fern-sdk-group-name': ['schedules'],
  'x-fern-sdk-method-name': 'create_run',
  request: {
    body: {
      content: { 'application/json': { schema: CreateScheduleRunRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: CreateScheduleRunResponseSchema } },
      description: 'Run created.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request or turn input.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The caller is not the schedule creator.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Schedule or agent not found.',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Run name conflict (retry).',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The run cannot be started (e.g. agent resources unavailable).',
    },
  },
});

export const createScheduleRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'Create a schedule',
  description: 'Create a schedule for an existing agent (by name) and add its first pending run when active.',
  'x-fern-sdk-group-name': ['schedules'],
  'x-fern-sdk-method-name': 'create',
  request: {
    body: {
      content: { 'application/json': { schema: CreateScheduleRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: GetScheduleResponseSchema } },
      description: 'Created schedule.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unknown agent or invalid cron.',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The name is already taken for this agent, or the schedule was modified concurrently (retry).',
    },
  },
});

export const getScheduleRoute = createRoute({
  method: 'get',
  path: '/{schedule_id}',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'Get a schedule',
  description: 'Get a schedule by id.',
  'x-fern-sdk-group-name': ['schedules'],
  'x-fern-sdk-method-name': 'get',
  request: {
    params: ScheduleIdParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetScheduleResponseSchema } },
      description: 'The schedule.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The caller is not the schedule creator.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Not found.',
    },
  },
});

export const putScheduleRoute = createRoute({
  method: 'put',
  path: '/{schedule_id}',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'Update a schedule',
  description: 'Replace name and manifest; replaces or drops the pending run when status/cron/timezone change.',
  'x-fern-sdk-group-name': ['schedules'],
  'x-fern-sdk-method-name': 'update',
  request: {
    params: ScheduleIdParamsSchema,
    body: {
      content: { 'application/json': { schema: UpdateScheduleRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetScheduleResponseSchema } },
      description: 'Updated schedule.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid cron.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The caller is not the schedule creator.',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The name is already taken for this agent, or the schedule was modified concurrently (retry).',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Not found.',
    },
  },
});

export const deleteScheduleRoute = createRoute({
  method: 'delete',
  path: '/{schedule_id}',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'Delete a schedule',
  description: 'Delete a schedule and its runs. Idempotent.',
  'x-fern-sdk-group-name': ['schedules'],
  'x-fern-sdk-method-name': 'delete',
  request: {
    params: ScheduleIdParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: DeleteScheduleResponseSchema } },
      description: 'Deleted.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The caller is not the schedule creator.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unauthenticated.',
    },
  },
});
