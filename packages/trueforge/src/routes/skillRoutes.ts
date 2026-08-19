/**
 * DB-backed skill route definitions.
 * Admin routes mount at /api/v1/settings/skills; the chat list mounts at
 * /api/v1/skills.
 * Discovery catalog lives at GET /api/v1/catalogs/skills.
 */
import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import {
  CreateSkillRequestSchema,
  GetSkillResponseSchema,
  ListAvailableSkillsResponseSchema,
  ListSkillsResponseSchema,
  UpdateSkillRequestSchema,
} from '../schemas/skill';
import { OpenApiTag } from './openapiTags';

/** Chat/composer read view — mounted at /api/v1/skills (not under settings). */
export const listAvailableSkillsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.SKILLS],
  summary: 'List skills for chat',
  description: 'Configured skills as a slim name/description list for the composer.',
  'x-fern-sdk-group-name': ['skills'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: ListAvailableSkillsResponseSchema } },
      description: 'All configured skills (chat projection).',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
  },
});

export const listConfiguredSkillsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.SKILLS],
  summary: 'List configured skills',
  description: 'All configured skills with nested manifests (settings / admin projection).',
  'x-fern-sdk-group-name': ['settings', 'skills'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: ListSkillsResponseSchema } },
      description: 'All configured skills.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
    403: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the caller is authenticated but not an admin.',
    },
  },
});

export const createSkillRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [OpenApiTag.SKILLS],
  summary: 'Create a skill',
  description: 'Creates a skill keyed by `name`. Fails if `name` is already taken.',
  'x-fern-sdk-group-name': ['settings', 'skills'],
  'x-fern-sdk-method-name': 'create',
  request: {
    body: {
      content: { 'application/json': { schema: CreateSkillRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: GetSkillResponseSchema } },
      description: 'The created skill.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'A skill with this name already exists.',
    },
  },
});

export const putSkillRoute = createRoute({
  method: 'put',
  path: '/',
  tags: [OpenApiTag.SKILLS],
  summary: 'Create or replace a skill',
  description: 'Full upsert keyed by `name`: creates the skill or replaces its entire manifest.',
  'x-fern-sdk-group-name': ['settings', 'skills'],
  'x-fern-sdk-method-name': 'create_or_update',
  request: {
    body: {
      content: { 'application/json': { schema: UpdateSkillRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetSkillResponseSchema } },
      description: 'The saved skill.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
  },
});
