/**
 * Schedule route definitions (mounted at /api/v1/schedules).
 * Handlers are registered in apis/schedules.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { NameSchema } from '../schemas/common';
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

export const ListSchedulesQuerySchema = z
  .object({
    agent_name: NameSchema.optional(),
  })
  .openapi('ListSchedulesQuery');

export const listSchedulesRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.SCHEDULES],
  summary: 'List schedules',
  description: 'List schedules for the tenant, newest first. Optionally filter by `agent_name`.',
  'x-fern-sdk-group-name': ['schedules'],
  'x-fern-sdk-method-name': 'list',
  request: {
    query: ListSchedulesQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListSchedulesResponseSchema } },
      description: 'Matching schedules.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unauthenticated.',
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
      description: 'The schedule was modified concurrently (usually the controller advancing it). Retry.',
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
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The schedule was modified concurrently (usually the controller advancing it). Retry.',
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
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Unauthenticated.',
    },
  },
});
