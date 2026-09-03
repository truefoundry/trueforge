import { createRoute, z } from '@hono/zod-openapi';
import { MCP_SERVERS_PAGE_LIMIT, MCP_SERVERS_PAGE_LIMIT_MAX } from '../schemas/common';
import { RequestErrorResponseSchema } from '../schemas/errors';
import {
  CreateMcpServerRequestSchema,
  GetMcpServerResponseSchema,
  ListAvailableMcpServersResponseSchema,
  ListMcpServersResponseSchema,
  McpAuthStatusSchema,
  UpdateMcpServerRequestSchema,
} from '../schemas/mcpServer';
import { trueFoundryManagedResponse } from '../truefoundry/trueFoundryManaged';
import { TOKEN_PAGINATION } from './fernExtensions';
import { OpenApiTag } from './openapiTags';

export const ListMcpServersQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MCP_SERVERS_PAGE_LIMIT_MAX)
      .optional()
      .default(MCP_SERVERS_PAGE_LIMIT)
      .describe(`Page size. Defaults to ${String(MCP_SERVERS_PAGE_LIMIT)}, max ${String(MCP_SERVERS_PAGE_LIMIT_MAX)}.`),
    page_token: z.string().optional().describe('Opaque token from a previous response `next_page_token`.'),
  })
  .openapi('ListMCPServersQuery');

/** Chat/composer MCP list (not under settings). */
export const listAvailableMcpServersRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.MCP_SERVERS],
  summary: 'List MCP servers for chat',
  description: 'Paginated MCP servers as a slim name/url list for the composer.',
  'x-fern-sdk-group-name': ['mcpServers'],
  'x-fern-sdk-method-name': 'list',
  'x-fern-pagination': TOKEN_PAGINATION,
  request: {
    query: ListMcpServersQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListAvailableMcpServersResponseSchema } },
      description: 'Paginated MCP servers (chat projection).',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid query parameters or page token.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
  },
});

export const listMcpServersRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [OpenApiTag.MCP_SERVERS],
  summary: 'List MCP servers',
  description: 'Paginated MCP servers with auth_status. Header secrets are redacted.',
  'x-fern-sdk-group-name': ['settings', 'mcpServers'],
  'x-fern-sdk-method-name': 'list',
  'x-fern-pagination': TOKEN_PAGINATION,
  request: {
    query: ListMcpServersQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListMcpServersResponseSchema } },
      description: 'Paginated MCP servers',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid query parameters or page token.',
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

const McpServerNameParamsSchema = z.object({
  name: z.string().min(1).describe('MCP server name.'),
});

export const getMcpServerRoute = createRoute({
  method: 'get',
  path: '/{name}',
  tags: [OpenApiTag.MCP_SERVERS],
  summary: 'Get a single MCP server by name',
  description:
    'A single MCP server by name, with nested live auth_status (settings / admin projection). Header auth values are redacted.',
  'x-fern-sdk-group-name': ['settings', 'mcpServers'],
  'x-fern-sdk-method-name': 'get',
  request: {
    params: McpServerNameParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetMcpServerResponseSchema } },
      description: 'The MCP server',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'MCP server not found.',
    },
  },
});

export const createMcpServerRoute = createRoute({
  method: 'post',
  path: '/',
  tags: [OpenApiTag.MCP_SERVERS],
  summary: 'Create an MCP server',
  description:
    'Creates an MCP server by `name`. Fails if `name` is already taken. Runs DCR registration when `auth.type` is `dcr`. ' +
    'Header secrets: real value required; redacted with no stored value returns 400.',
  'x-fern-sdk-group-name': ['settings', 'mcpServers'],
  'x-fern-sdk-method-name': 'create',
  request: {
    body: {
      content: { 'application/json': { schema: CreateMcpServerRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: GetMcpServerResponseSchema } },
      description: 'The created MCP server with auth_status',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body, or redacted header secret with no stored value to keep.',
    },
    409: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'An MCP server with this name already exists.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The server cannot satisfy `auth.type: dcr` (e.g. it advertises no registration_endpoint).',
    },
    424: trueFoundryManagedResponse,
  },
});

export const putMcpServerRoute = createRoute({
  method: 'put',
  path: '/',
  tags: [OpenApiTag.MCP_SERVERS],
  summary: 'Create or replace an MCP server',
  description:
    'Create or replace by `name`. Header secrets: real value sets/rotates; redacted keeps existing (400 if none).',
  'x-fern-sdk-group-name': ['settings', 'mcpServers'],
  'x-fern-sdk-method-name': 'create_or_update',
  request: {
    body: {
      content: { 'application/json': { schema: UpdateMcpServerRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetMcpServerResponseSchema } },
      description: 'The saved MCP server with auth_status',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body, or redacted header secret with no stored value to keep.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The server cannot satisfy `auth.type: dcr` (e.g. it advertises no registration_endpoint).',
    },
    424: trueFoundryManagedResponse,
  },
});

const ListMcpServerToolsResponseSchema = z
  .object({
    // TODO: Type tools/list entries to the MCP tool shape (name, description, inputSchema, …) for OpenAPI quality.
    data: z
      .array(z.record(z.string(), z.unknown()))
      .describe('MCP `tools/list` entries, passed through verbatim from the MCP server.'),
  })
  .openapi('ListMCPServerToolsResponse');

export const listMcpServerToolsRoute = createRoute({
  method: 'get',
  path: '/{name}/tools',
  tags: [OpenApiTag.MCP_SERVERS],
  summary: 'List tools of an MCP server',
  'x-fern-sdk-group-name': ['mcpServers'],
  'x-fern-sdk-method-name': 'list_tools',
  description: 'All tools exposed by the given MCP server (non-paginated), as returned by the MCP `tools/list` call.',
  request: {
    params: McpServerNameParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListMcpServerToolsResponseSchema } },
      description: 'All tools of the MCP server.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'OIDC is configured and the request has no valid session cookie.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'MCP server not found.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The MCP server requires authentication (does not trigger browser OIDC login).',
    },
    502: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The MCP server could not be reached or returned an error.',
    },
  },
});

const McpAuthorizeQuerySchema = z.object({
  return_to: z.string().optional().describe('Same-origin path to land in the browser after consent.'),
});

export const authorizeMcpServerRoute = createRoute({
  method: 'get',
  path: '/{name}/authorize',
  tags: [OpenApiTag.MCP_SERVERS],
  summary: 'Start (or short-circuit) the auth flow for an MCP server',
  'x-fern-sdk-group-name': ['mcpServers'],
  'x-fern-sdk-method-name': 'authorize',
  description:
    'Returns current auth status. When OAuth is required, includes an authorization URL. Optional return_to is the post-consent landing path.',
  request: {
    params: McpServerNameParamsSchema,
    query: McpAuthorizeQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: McpAuthStatusSchema } },
      description: 'Either already authenticated, or an authorization URL to redirect to.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid return_to.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'MCP server not found.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'DCR could not be completed for this server (e.g. it lacks a registration_endpoint).',
    },
    424: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The authorization server failed dynamic client registration or authorization startup.',
    },
    500: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Server misconfiguration (e.g. PUBLIC_BASE_URL unset).',
    },
  },
});

export const deleteAuthorizationMcpServerRoute = createRoute({
  method: 'delete',
  path: '/{name}/authorize',
  tags: [OpenApiTag.MCP_SERVERS],
  summary: 'Disconnect OAuth for an MCP server',
  'x-fern-sdk-group-name': ['mcpServers'],
  'x-fern-sdk-method-name': 'delete_authorization',
  description:
    'Disconnects OAuth for the MCP server when applicable and returns the updated server with auth_status. ' +
    'No-op when the server does not use stored OAuth tokens.',
  request: {
    params: McpServerNameParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetMcpServerResponseSchema } },
      description: 'The MCP server after disconnect.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'MCP server not found.',
    },
  },
});
