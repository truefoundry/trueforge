import { createRoute, z } from '@hono/zod-openapi';
import { McpServerEntrySchema } from '../legacy-registry-store/schemas';
import { RequestErrorResponseSchema } from '../schemas/errors';

const MCP_SERVERS_TAG = 'Legacy MCP Servers';

// Extends the yaml-validation schema with a response-only field — `auth_status` isn't a valid
// mcp.yaml key, so it's added here rather than on McpServerEntrySchema itself.
const McpServerResponseSchema = McpServerEntrySchema.extend({
  auth_status: z
    .enum(['authenticated', 'authentication_required', 'not_required'])
    .describe(
      'Passive check only: whether a stored, unexpired token exists. Never attempts a live refresh, ' +
        'so an expired-but-refreshable token still reads as `authentication_required` here. ' +
        '`not_required` for servers without `auth` configured.',
    ),
}).openapi('McpServerEntry');

const ListMcpServersResponseSchema = z
  .object({
    data: z.array(McpServerResponseSchema),
  })
  .openapi('ListMcpServersResponse');

export const listMcpServersRoute = createRoute({
  method: 'get',
  path: '/',
  tags: [MCP_SERVERS_TAG],
  summary: 'List MCP servers',
  description:
    'MCP servers declared in mcp.yaml, each with a passive auth_status snapshot. Auth headers are ' +
    'configured via env vars and never returned.',
  'x-fern-sdk-group-name': ['legacy', 'mcp_servers'],
  'x-fern-sdk-method-name': 'list',
  responses: {
    200: {
      content: { 'application/json': { schema: ListMcpServersResponseSchema } },
      description: 'All configured MCP servers.',
    },
  },
});

// Tools are passed through verbatim from the MCP server's `tools/list`
// response (name, description, inputSchema, outputSchema, annotations, ...),
// so they are documented as opaque objects rather than a copied MCP schema —
// the MCP spec owns the tool shape. The SDK's own ToolSchema can't be reused
// here: it is Zod v4, while @hono/zod-openapi is Zod v3.
const ListMcpToolsResponseSchema = z
  .object({
    data: z
      .array(z.record(z.unknown()))
      .describe('MCP `tools/list` entries, passed through verbatim from the MCP server.'),
  })
  .openapi('ListMcpToolsResponse');

const McpServerNameParamsSchema = z.object({
  name: z.string().min(1).describe('MCP server name from mcp.yaml.'),
});

export const listMcpToolsRoute = createRoute({
  method: 'get',
  path: '/{name}/tools',
  tags: [MCP_SERVERS_TAG],
  summary: 'List tools of an MCP server',
  'x-fern-sdk-group-name': ['legacy', 'mcp_servers'],
  'x-fern-sdk-method-name': 'list_tools',
  description:
    'All tools exposed by the given MCP server (non-paginated), as returned by the MCP `tools/list` call. No agent-spec tool selectors are applied — this is the raw server catalog.',
  request: {
    params: McpServerNameParamsSchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListMcpToolsResponseSchema } },
      description: 'All tools of the MCP server.',
    },
    401: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The MCP server requires authentication (configure MCP_HEADERS / MCP_{NAME}_HEADERS).',
    },
    404: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'MCP server not declared in mcp.yaml.',
    },
    502: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'The MCP server could not be reached or returned an error.',
    },
  },
});
