import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import { runTool } from '../result';

export function registerModelTools(server: McpServer, client: TrueForge): void {
  server.registerTool(
    'list_models',
    {
      description:
        'List the models you can reference in an agent or draft manifest. Use it to find a valid model ' +
        'identifier before setting one on an agent.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => runTool(() => client.models.list()),
  );
}
