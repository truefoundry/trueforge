/**
 * DB-backed MCP server route definitions.
 * Admin routes mount at /api/v1/settings/mcp-servers; the chat list and
 * authorize routes mount at /api/v1/mcp-servers.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { GetMcpServerCatalogResponseSchema } from '../schemas/mcpCatalog';
import {
  GetMcpServerResponseSchema,
  ListAvailableMcpServersResponseSchema,
  ListMcpServersResponseSchema,
  McpAuthStatusSchema,
  PutMcpServerRequestSchema,
  PutMcpServerResponseSchema,
} from '../schemas/mcpServer';

const MCP_SERVERS_TAG = 'MCP Servers';

export const getMcpServerCatalogRoute = createRoute({
  method: 'get',
  path: '/catalog',
  tags: [MCP_SERVERS_TAG],
  summary: 'Get the MCP catalog',
  description:
    'MCP server presets shipped with the server (mcp-catalog.yaml). Discovery-only: copy an entry ' +
    'into PUT /settings/mcp-servers to configure it.',
  'x-fern-sdk-group-name': ['settings', 'mcpServers'],
  'x-fern-sdk-method-name': 'catalog',
  responses: {
    200: {
      content: { 'application/json': { schema: GetMcpServerCatalogResponseSchema } },
      description: 'The shipped catalog, verbatim.',
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

/** Chat/composer read view — mounted at /api/v1/mcp-servers (not under settings). */
export const listAvailableMcpServersRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [MCP_SERVERS_TAG],
  summary: 'List MCP servers for chat',
  description: 'MCP servers as a slim name/url list for the composer. No auth or auth_status.',
  'x-fern-sdk-group-name': ['mcpServers'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: ListAvailableMcpServersResponseSchema } },
      description: 'All MCP servers (chat projection).',
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
  tags: [MCP_SERVERS_TAG],
  summary: 'List MCP servers',
  description: 'All MCP servers with nested auth_status (settings / admin projection).',
  'x-fern-sdk-group-name': ['settings', 'mcpServers'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: ListMcpServersResponseSchema } },
      description: 'All MCP servers.',
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
  tags: [MCP_SERVERS_TAG],
  summary: 'Get a single MCP server by name',
  description: 'A single MCP server by name, with nested auth_status (settings / admin projection).',
  'x-fern-sdk-group-name': ['settings', 'mcpServers'],
  'x-fern-sdk-method-name': 'get',
  request: {
    params: McpServerNameParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetMcpServerResponseSchema } },
      description: 'The MCP server.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'MCP server not found.',
    },
  },
});

export const putMcpServerRoute = createRoute({
  method: 'put',
  path: '/',
  tags: [MCP_SERVERS_TAG],
  summary: 'Create or replace an MCP server',
  description:
    'Full upsert keyed by `name`: creates the server or replaces its manifest. Does not start DCR or ' +
    'modify stored oauth_server / oauth_client columns.',
  'x-fern-sdk-group-name': ['settings', 'mcpServers'],
  'x-fern-sdk-method-name': 'upsert',
  request: {
    body: {
      content: { 'application/json': { schema: PutMcpServerRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PutMcpServerResponseSchema } },
      description: 'The saved MCP server with stub auth_status.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid request body.',
    },
    422: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The server cannot satisfy `auth.type: dcr` (e.g. it advertises no registration_endpoint).',
    },
  },
});

const ListMcpServerToolsResponseSchema = z
  .object({
    // TODO: Type tools/list entries to the MCP tool shape (name, description, inputSchema, …) for OpenAPI quality.
    data: z
      .array(z.record(z.string(), z.unknown()))
      .describe('MCP `tools/list` entries, passed through verbatim from the MCP server.'),
  })
  .openapi('ListMcpServerToolsResponse');

export const listMcpServerToolsRoute = createRoute({
  method: 'get',
  path: '/{name}/tools',
  tags: [MCP_SERVERS_TAG],
  summary: 'List tools of an MCP server',
  'x-fern-sdk-group-name': ['settings', 'mcpServers'],
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
      description: 'Harness session login required.',
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
  redirect_url: z
    .url()
    .optional()
    .describe('Optional FE landing URL the OAuth callback redirects to, with `isSuccess`/`reason` appended.'),
});

export const authorizeMcpServerRoute = createRoute({
  method: 'get',
  path: '/{name}/authorize',
  tags: [MCP_SERVERS_TAG],
  summary: 'Start (or short-circuit) the auth flow for an MCP server',
  'x-fern-sdk-group-name': ['mcpServers'],
  'x-fern-sdk-method-name': 'authorize',
  description:
    'For servers without auth returns not_required, and for header credentials returns authenticated ' +
    '(no browser flow). For auth.type dcr, returns authenticated when a usable (or refreshable) token ' +
    'exists; otherwise runs DCR if needed and returns auth_required with an authorization URL. ' +
    'Optional redirect_url is where the OAuth callback then redirects the browser; without it the callback returns JSON.',
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
      description: 'Invalid redirect_url.',
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

export const deleteMcpServerAuthRoute = createRoute({
  method: 'delete',
  path: '/{name}/authorize',
  tags: [MCP_SERVERS_TAG],
  summary: 'Disconnect OAuth for an MCP server',
  'x-fern-sdk-group-name': ['mcpServers'],
  'x-fern-sdk-method-name': 'delete_authorize',
  description:
    'For auth.type dcr, deletes the stored OAuth token and returns the server with auth_status ' +
    'auth_required, keeping the dynamically registered OAuth client so the next authorize can reuse it. ' +
    'No-op for header or no-auth servers (returns the server unchanged).',
  request: {
    params: McpServerNameParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: PutMcpServerResponseSchema } },
      description: 'The MCP server after disconnect (auth_required for dcr).',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'MCP server not found.',
    },
  },
});
