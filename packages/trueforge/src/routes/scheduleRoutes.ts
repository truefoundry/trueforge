/**
 * Schedule route definitions (mounted at /api/v1/schedules).
 * Handlers are registered in apis/schedules.ts.
 *
 */
import { createRoute, z } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import {
  CreateScheduleRequestSchema,
  DeleteScheduleResponseSchema,
  GetScheduleResponseSchema,
  ListSchedulesResponseSchema,
  UpdateScheduleRequestSchema,
} from '../schemas/schedule';
import { OpenApiTag } from './openapiTags';

export const ScheduleIdParamsSchema = z.object({
  schedule_id: z.string().min(1).max(64).describe('Immutable schedule identifier.'),
});

export const ListSchedulesQuerySchema = z.object({
  agent_id: z.string().min(1).optional().describe('When set, only schedules bound to this agent are returned.'),
});

export const listSchedulesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'List schedules',
  description: 'All schedules for the tenant, newest first. Optionally filtered by bound agent.',
  'x-fern-sdk-group-name': ['schedules'],
  'x-fern-sdk-method-name': 'list',
  request: {
    query: ListSchedulesQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListSchedulesResponseSchema } },
      description: 'The matching schedules.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
  },
});

export const createScheduleRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'Create a schedule',
  description:
    'Creates an active schedule for an existing agent and arms its first run. The agent binding is immutable. ' +
    'Every run executes as the caller.',
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
      description: 'The created schedule.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unknown agent, unusable cron expression, or a cron that fires more often than allowed.',
    },
  },
});

export const getScheduleRoute = createRoute({
  method: 'get',
  path: '/{schedule_id}',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'Get a schedule',
  description: 'Fetch a schedule by immutable id.',
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
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Schedule not found.',
    },
  },
});

export const putScheduleRoute = createRoute({
  method: 'put',
  path: '/{schedule_id}',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'Update a schedule',
  description:
    'Replaces the manifest for an existing schedule. A cron or timezone change re-arms the pending run, so the ' +
    'next fire follows the new expression. The agent binding cannot be changed; use pause/resume for status.',
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
      description: 'The saved schedule.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unusable cron expression, or a cron that fires more often than allowed.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Schedule not found.',
    },
  },
});

export const deleteScheduleRoute = createRoute({
  method: 'delete',
  path: '/{schedule_id}',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'Delete a schedule',
  description: 'Delete a schedule and its run history by immutable id. Idempotent if already gone.',
  'x-fern-sdk-group-name': ['schedules'],
  'x-fern-sdk-method-name': 'delete',
  request: {
    params: ScheduleIdParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: DeleteScheduleResponseSchema } },
      description: 'Schedule deleted.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
  },
});

export const pauseScheduleRoute = createRoute({
  method: 'post',
  path: '/{schedule_id}/pause',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'Pause a schedule',
  description: 'Stops firing and drops the pending run. Runs already in flight continue. Idempotent.',
  'x-fern-sdk-group-name': ['schedules'],
  'x-fern-sdk-method-name': 'pause',
  request: {
    params: ScheduleIdParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetScheduleResponseSchema } },
      description: 'The paused schedule.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Schedule not found.',
    },
  },
});

export const resumeScheduleRoute = createRoute({
  method: 'post',
  path: '/{schedule_id}/resume',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'Resume a schedule',
  description:
    'Re-arms the schedule from now — slots missed while paused are not backfilled. Idempotent.',
  'x-fern-sdk-group-name': ['schedules'],
  'x-fern-sdk-method-name': 'resume',
  request: {
    params: ScheduleIdParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetScheduleResponseSchema } },
      description: 'The resumed schedule.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The stored cron expression can no longer produce a fire time.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Schedule not found.',
    },
  },
});
