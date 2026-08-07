/**
 * Agent registry route definitions (mounted at /api/v1/agents).
 * Handlers are registered in apis/agents.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import {
  AgentWriteRequestSchema,
  CreateAgentResponseSchema,
  GetAgentResponseSchema,
  ListAgentsResponseSchema,
  PutAgentResponseSchema,
  UpdateAgentRequestSchema,
} from '../schemas/agent';
import { NameSchema } from '../schemas/common';
import { RequestErrorResponseSchema } from '../schemas/errors';

const AGENTS_TAG = 'Agents';

export const AgentIdParamsSchema = z.object({
  agent_id: z.string().min(1).max(64).describe('Immutable agent identifier.'),
});

export const AgentNameParamsSchema = z.object({
  name: NameSchema.describe('Immutable unique agent name within the tenant.'),
});

export const listAgentsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [AGENTS_TAG],
  summary: 'List agents',
  description: 'All configured agents for the tenant.',
  'x-fern-sdk-group-name': ['agents'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: ListAgentsResponseSchema } },
      description: 'All configured agents.',
    },
  },
});

export const createAgentRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [AGENTS_TAG],
  summary: 'Create an agent',
  description:
    'Creates an agent and allocates an immutable id. Fails if `name` is already taken. Name cannot be changed later.',
  'x-fern-sdk-group-name': ['agents'],
  'x-fern-sdk-method-name': 'create',
  request: {
    body: {
      content: { 'application/json': { schema: AgentWriteRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CreateAgentResponseSchema } },
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
  tags: [AGENTS_TAG],
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
  tags: [AGENTS_TAG],
  summary: 'Delete an agent',
  description: 'Delete a configured agent by immutable id. Idempotent if already gone.',
  'x-fern-sdk-group-name': ['agents'],
  'x-fern-sdk-method-name': 'delete',
  request: {
    params: AgentIdParamsSchema,
  },
  responses: {
    204: {
      description: 'Agent deleted.',
    },
  },
});

export const putAgentRoute = createRoute({
  method: 'put',
  path: '/{name}',
  tags: [AGENTS_TAG],
  summary: 'Update an agent',
  description: 'Replaces the AgentSpec for an existing agent keyed by immutable `name`.',
  'x-fern-sdk-group-name': ['agents'],
  'x-fern-sdk-method-name': 'update',
  request: {
    params: AgentNameParamsSchema,
    body: {
      content: { 'application/json': { schema: UpdateAgentRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PutAgentResponseSchema } },
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
