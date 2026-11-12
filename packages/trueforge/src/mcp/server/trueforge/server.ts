import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TRUEFORGE_MCP_ID } from '@truefoundry/trueforge-core/agent-session';
import { z } from 'zod';
import type { McpToolDescriptor } from './openApiTools';
import { runTool } from './result';
import { registerCustomTools } from './tools/custom';
import type { WireApiClient } from './wireApiClient';

/** Server-level framing surfaced in the MCP `initialize` response. */
const TRUEFORGE_SERVER_TITLE = 'TrueForge server';

const TRUEFORGE_INSTRUCTIONS =
  'Build and configure agents and their supporting entities on the same TrueForge harness you are ' +
  'running on: create, update, and read agents, schedules, and sandbox environments, and read the ' +
  'configured models, MCP servers, and skills they can reference. You cannot run agents or execute ' +
  'turns through this server; it only defines and configures them.';

/** A tool descriptor with its JSON Schema already compiled to Zod. */
export interface CompiledMcpTool {
  descriptor: McpToolDescriptor;
  inputSchema: ReturnType<typeof z.fromJSONSchema>;
}

export function compileMcpTools(tools: readonly McpToolDescriptor[]): CompiledMcpTool[] {
  return tools.map(descriptor => ({ descriptor, inputSchema: z.fromJSONSchema(descriptor.inputSchema) }));
}

/** Register all OpenAPI-annotated tools with their (precompiled) schemas and fixed HTTP mappings. */
export function registerOpenApiTools(
  server: McpServer,
  client: WireApiClient,
  tools: readonly CompiledMcpTool[],
): void {
  for (const { descriptor, inputSchema } of tools) {
    server.registerTool(
      descriptor.name,
      {
        description: descriptor.description,
        inputSchema,
        annotations: descriptor.annotations,
      },
      async (input, extra) => runTool(() => client.execute(descriptor, input as Record<string, unknown>, extra.signal)),
    );
  }
}

/** Build a stateless TrueForge MCP server bound to a request-scoped API adapter. */
export function createTrueForgeMcpServer(input: {
  client: WireApiClient;
  version: string;
  tools: readonly CompiledMcpTool[];
}): McpServer {
  const server = new McpServer(
    { name: TRUEFORGE_MCP_ID, title: TRUEFORGE_SERVER_TITLE, version: input.version },
    { instructions: TRUEFORGE_INSTRUCTIONS },
  );
  registerOpenApiTools(server, input.client, input.tools);
  registerCustomTools(
    server,
    input.client,
    input.tools.map(tool => tool.descriptor),
  );
  return server;
}
