import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IsomorphicHeaders } from '@modelcontextprotocol/sdk/types.js';
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import { TRUEFORGE_SESSION_HEADER } from '../headers';
import { ToolResultError, runTool } from '../result';

function headerValue(headers: IsomorphicHeaders | undefined, name: string): string | undefined {
  const raw = headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value.length === 0 ? undefined : value;
}

export function registerSessionTools(server: McpServer, client: TrueForge): void {
  server.registerTool(
    'get_current_session',
    {
      description:
        "Read this session's configuration: its title and inline agent spec, including the model, instructions, " +
        'MCP servers, skills, and sandbox configured here. This returns the configuration, not the message transcript.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async (_args, extra) =>
      runTool(() => {
        const sessionId = headerValue(extra.requestInfo?.headers, TRUEFORGE_SESSION_HEADER);
        if (sessionId === undefined) {
          throw new ToolResultError(400, 'No current chat. This tool is only available during a draft session turn.');
        }
        return client.sessions.get(sessionId);
      }),
  );
}
