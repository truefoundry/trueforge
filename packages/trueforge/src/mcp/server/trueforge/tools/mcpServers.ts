import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import { z } from 'zod';
import { runTool } from '../result';

export function registerMcpServerTools(server: McpServer, client: TrueForge): void {
  server.registerTool(
    'list_mcp_servers',
    {
      description:
        'List the MCP servers you can attach to an agent, each with its current authentication status so you ' +
        'know whether it is ready to use. Check this before referencing an MCP server in a manifest.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => runTool(() => client.mcpServers.list()),
  );

  server.registerTool(
    'get_mcp_server',
    {
      description:
        'Fetch one MCP server by name — its public connection details and current authentication status — to ' +
        'confirm it exists and is authenticated before referencing it in an agent.',
      inputSchema: { name: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => runTool(() => client.mcpServers.get(name)),
  );
}
