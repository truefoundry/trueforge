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
} from '../schemas/agent';
import { RequestErrorResponseSchema } from '../schemas/errors';

const AGENTS_TAG = 'Agents';

export const AgentIdParamsSchema = z.object({
  agent_id: z.string().min(1).max(64).describe('Immutable agent identifier.'),
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
  description: 'Creates an agent and allocates an immutable id. Fails if `name` is already taken.',
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

export const putAgentRoute = createRoute({
  method: 'put',
  path: '/{agent_id}',
  tags: [AGENTS_TAG],
  summary: 'Update an agent',
  description:
    'Replaces `name` and AgentSpec for an existing agent by id. The id is never changed; renames are allowed via a new `name`.',
  'x-fern-sdk-group-name': ['agents'],
  'x-fern-sdk-method-name': 'update',
  request: {
    params: AgentIdParamsSchema,
    body: {
      content: { 'application/json': { schema: AgentWriteRequestSchema } },
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
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Another agent already uses this name.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description:
        'The agent spec is valid but requires a capability this server does not provide (e.g. sandbox or skills).',
    },
  },
});
