import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import { z } from 'zod';
import { runTool } from '../result';

export function registerAgentTools(server: McpServer, client: TrueForge): void {
  server.registerTool(
    'list_agents',
    {
      description:
        'Discover existing agents — for example to find one to inspect or update, or to check whether a ' +
        'name is already taken before creating a new agent. Supports optional filters and returns one paginated page.',
      inputSchema: {
        limit: z.number().int().positive().optional(),
        page_token: z.string().optional(),
        agent_name: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limit, page_token, agent_name }) =>
      runTool(async () => {
        const page = await client.agents.list({
          limit,
          pageToken: page_token,
          agentName: agent_name,
        } as Parameters<typeof client.agents.list>[0]);
        return page.response;
      }),
  );

  server.registerTool(
    'get_agent',
    {
      description:
        "Fetch one agent's full definition by its immutable ID, including the complete manifest. Use it to " +
        'review an agent or to get a working template before updating it.',
      inputSchema: { agent_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ agent_id }) => runTool(() => client.agents.get(agent_id)),
  );

  server.registerTool(
    'create_agent',
    {
      description:
        'Create a named agent from a complete manifest. The name is immutable and all referenced models, ' +
        'MCP servers, skills, and sandbox environments must exist. Call get_agent on an existing agent to ' +
        'obtain a complete, valid manifest to use as a template.',
      inputSchema: {
        name: z.string(),
        description: z.string(),
        manifest: AgentSpecSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ name, description, manifest }) =>
      runTool(() =>
        client.agents.create({ name, description, manifest } as unknown as Parameters<typeof client.agents.create>[0]),
      ),
  );

  server.registerTool(
    'update_agent',
    {
      description:
        "Replace an agent's description and complete manifest by immutable ID. This is a full replacement: " +
        'omitted manifest fields are removed. Call get_agent first to retrieve the current complete manifest ' +
        'and edit it as a template rather than authoring one from scratch.',
      inputSchema: {
        agent_id: z.string(),
        description: z.string().optional(),
        manifest: AgentSpecSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ agent_id, description, manifest }) =>
      runTool(() =>
        client.agents.update(agent_id, { description, manifest } as unknown as Parameters<
          typeof client.agents.update
        >[1]),
      ),
  );
}
