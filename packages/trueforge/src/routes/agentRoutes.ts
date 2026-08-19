/**
 * Agent registry route definitions (mounted at /api/v1/agents).
 * Handlers are registered in apis/agents.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import {
  CreateAgentRequestSchema,
  DeleteAgentResponseSchema,
  GetAgentResponseSchema,
  ListAgentsResponseSchema,
  UpdateAgentRequestSchema,
} from '../schemas/agent';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { OpenApiTag } from './openapiTags';

export const AgentIdParamsSchema = z.object({
  agent_id: z.string().min(1).max(64).describe('Immutable agent identifier.'),
});

export const listAgentsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.AGENTS],
  summary: 'List agents',
  description: 'All configured agents for the tenant.',
  'x-fern-sdk-group-name': ['agents'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: ListAgentsResponseSchema } },
      description: 'All configured agents.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
  },
});

export const createAgentRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [OpenApiTag.AGENTS],
  summary: 'Create an agent',
  description:
    'Creates an agent and allocates an immutable id. Fails if `name` is already taken. Name cannot be changed later.',
  'x-fern-sdk-group-name': ['agents'],
  'x-fern-sdk-method-name': 'create',
  request: {
    body: {
      content: { 'application/json': { schema: CreateAgentRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: GetAgentResponseSchema } },
      description: 'The created agent.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body or unknown model/MCP/skill refs.',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'An agent with this name already exists.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description:
        'The agent spec is valid but requires a capability this server does not provide (e.g. sandbox or skills).',
    },
  },
});

export const getAgentRoute = createRoute({
  method: 'get',
  path: '/{agent_id}',
  tags: [OpenApiTag.AGENTS],
  summary: 'Get an agent',
  description: 'Fetch a configured agent by immutable id.',
  'x-fern-sdk-group-name': ['agents'],
  'x-fern-sdk-method-name': 'get',
  request: {
    params: AgentIdParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetAgentResponseSchema } },
      description: 'The agent.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Agent not found.',
    },
  },
});

export const deleteAgentRoute = createRoute({
  method: 'delete',
  path: '/{agent_id}',
  tags: [OpenApiTag.AGENTS],
  summary: 'Delete an agent',
  description: 'Delete a configured agent by immutable id. Idempotent if already gone.',
  'x-fern-sdk-group-name': ['agents'],
  'x-fern-sdk-method-name': 'delete',
  request: {
    params: AgentIdParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: DeleteAgentResponseSchema } },
      description: 'Agent deleted.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
  },
});

export const putAgentRoute = createRoute({
  method: 'put',
  path: '/{agent_id}',
  tags: [OpenApiTag.AGENTS],
  summary: 'Update an agent',
  description: 'Replaces the manifest for an existing agent keyed by immutable `agent_id`.',
  'x-fern-sdk-group-name': ['agents'],
  'x-fern-sdk-method-name': 'update',
  request: {
    params: AgentIdParamsSchema,
    body: {
      content: { 'application/json': { schema: UpdateAgentRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetAgentResponseSchema } },
      description: 'The saved agent.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body or unknown model/MCP/skill refs.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Agent not found.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description:
        'The agent spec is valid but requires a capability this server does not provide (e.g. sandbox or skills).',
    },
  },
});
