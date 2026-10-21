import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import { registerAgentTools } from './tools/agents';
import { registerMcpServerTools } from './tools/mcpServers';
import { registerModelTools } from './tools/models';
import { registerSandboxEnvironmentTools } from './tools/sandboxEnvironments';
import { registerScheduleTools } from './tools/schedules';
import { registerSkillTools } from './tools/skills';

/** The active built-in TrueForge connector name. See docs-internal/trueforge-mcp-server.md §3.5/§3.8. */
export const TRUEFORGE_CONNECTOR_NAME = 'trueforge';

/** Server-level framing surfaced in the MCP `initialize` response. */
const TRUEFORGE_SERVER_TITLE = 'TrueForge server';

const TRUEFORGE_INSTRUCTIONS =
  'Build and configure agents and their supporting entities on the same TrueForge harness you are ' +
  'running on: create, update, and read agents, schedules, and sandbox environments, and read the ' +
  'configured models, MCP servers, and skills they can reference. You cannot run agents or execute ' +
  'turns through this server; it only defines and configures them.';

/** Build a stateless TrueForge MCP server bound to a request-scoped SDK client. */
export function createTrueForgeMcpServer(input: { client: TrueForge; version: string }): McpServer {
  const server = new McpServer(
    { name: TRUEFORGE_CONNECTOR_NAME, title: TRUEFORGE_SERVER_TITLE, version: input.version },
    { instructions: TRUEFORGE_INSTRUCTIONS },
  );
  registerAgentTools(server, input.client);
  registerScheduleTools(server, input.client);
  registerSandboxEnvironmentTools(server, input.client);
  registerModelTools(server, input.client);
  registerMcpServerTools(server, input.client);
  registerSkillTools(server, input.client);
  return server;
}
