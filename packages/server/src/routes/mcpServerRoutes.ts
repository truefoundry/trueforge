/**
 * DB-backed MCP server route definitions.
 * Admin routes mount at /api/v1/settings/mcp-servers; the chat list mounts at
 * /api/v1/mcp-servers.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import { GetMcpServerCatalogResponseSchema } from '../schemas/mcpCatalog';
import {
  ListAvailableMcpServersResponseSchema,
  ListConfiguredMcpServersResponseSchema,
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
  },
});

/** Chat/composer read view — mounted at /api/v1/mcp-servers (not under settings). */
export const listAvailableMcpServersRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [MCP_SERVERS_TAG],
  summary: 'List MCP servers for chat',
  description: 'Configured MCP servers as a slim name/url list for the composer. No auth or auth_status.',
  'x-fern-sdk-group-name': ['mcpServers'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: ListAvailableMcpServersResponseSchema } },
      description: 'All configured MCP servers (chat projection).',
    },
  },
});

export const listConfiguredMcpServersRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [MCP_SERVERS_TAG],
  summary: 'List configured MCP servers',
  description: 'All configured MCP servers with nested auth_status (settings / admin projection).',
  'x-fern-sdk-group-name': ['settings', 'mcpServers'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: ListConfiguredMcpServersResponseSchema } },
      description: 'All configured MCP servers.',
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
  },
});

const ListMcpServerToolsResponseSchema = z
  .object({
    data: z
      .array(z.record(z.string(), z.unknown()))
      .describe('MCP `tools/list` entries, passed through verbatim from the MCP server.'),
  })
  .openapi('ListMcpServerToolsResponse');

const McpServerNameParamsSchema = z.object({
  name: z.string().min(1).describe('Configured MCP server name.'),
});

export const listMcpServerToolsRoute = createRoute({
  method: 'get',
  path: '/{name}/tools',
  tags: [MCP_SERVERS_TAG],
  summary: 'List tools of a configured MCP server',
  'x-fern-sdk-group-name': ['settings', 'mcpServers'],
  'x-fern-sdk-method-name': 'list_tools',
  description:
    'All tools exposed by the given configured MCP server (non-paginated), as returned by the MCP `tools/list` call.',
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
      description: 'The MCP server requires authentication.',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'MCP server not found.',
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

export const authorizeConfiguredMcpServerRoute = createRoute({
  method: 'get',
  path: '/{name}/authorize',
  tags: [MCP_SERVERS_TAG],
  summary: 'Start (or short-circuit) the auth flow for a configured MCP server',
  'x-fern-sdk-group-name': ['settings', 'mcpServers'],
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
      description: 'DCR or authorize URL construction failed (e.g. server lacks registration_endpoint).',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'MCP server not found.',
    },
    500: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Server misconfiguration (e.g. PUBLIC_BASE_URL unset).',
    },
  },
});

export const deleteConfiguredMcpServerAuthRoute = createRoute({
  method: 'delete',
  path: '/{name}/authorize',
  tags: [MCP_SERVERS_TAG],
  summary: 'Disconnect OAuth for a configured MCP server',
  'x-fern-sdk-group-name': ['settings', 'mcpServers'],
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
