import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentSpecSchema, type AgentSpec } from '@truefoundry/trueforge-core/agent-session';
import { serialization, type TrueForge, type TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { z } from 'zod';
import { runTool, TRUEFORGE_CONNECTOR_NAME } from '../result';

const SavedAgentManifestSchema = AgentSpecSchema.strict();

/** Saved agents reject the draft-only connector, so drop it before create or update. */
function manifestForSavedAgent(manifest: AgentSpec): AgentSpec {
  const servers = manifest.mcp_servers;
  if (servers === undefined) {
    return manifest;
  }
  const mcp_servers = servers.filter(server => server.name !== TRUEFORGE_CONNECTOR_NAME);
  if (mcp_servers.length === servers.length) {
    return manifest;
  }
  return { ...manifest, mcp_servers };
}

/** MCP tools use the HTTP wire shape; the generated SDK uses camelCase objects. */
function manifestForSdk(manifest: AgentSpec): TrueForgeApi.AgentSpec {
  return serialization.AgentSpec.parseOrThrow(manifest, {
    unrecognizedObjectKeys: 'fail',
  });
}

/** Keep tool responses in the same snake_case wire shape accepted by mutation tools. */
function agentResponseForTool(response: TrueForgeApi.GetAgentResponse): serialization.GetAgentResponse.Raw {
  return serialization.GetAgentResponse.jsonOrThrow(response, {
    unrecognizedObjectKeys: 'passthrough',
    allowUnrecognizedUnionMembers: true,
    allowUnrecognizedEnumValues: true,
    omitUndefined: true,
  });
}

/** Preserve the HTTP response shape for list results as well as individual agent results. */
function agentListResponseForTool(response: TrueForgeApi.ListAgentsResponse): serialization.ListAgentsResponse.Raw {
  return serialization.ListAgentsResponse.jsonOrThrow(response, {
    unrecognizedObjectKeys: 'passthrough',
    allowUnrecognizedUnionMembers: true,
    allowUnrecognizedEnumValues: true,
    omitUndefined: true,
  });
}

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
        return agentListResponseForTool(page.response);
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
    async ({ agent_id }) => runTool(async () => agentResponseForTool(await client.agents.get(agent_id))),
  );

  server.registerTool(
    'create_agent',
    {
      description:
        'Create a named agent from a complete manifest. The name is immutable and all referenced models, ' +
        'MCP servers, skills, and sandbox environments must exist.',
      inputSchema: {
        name: z.string(),
        description: z.string(),
        manifest: SavedAgentManifestSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ name, description, manifest }) =>
      runTool(() =>
        client.agents
          .create({
            name,
            description,
            manifest: manifestForSdk(manifestForSavedAgent(manifest)),
          })
          .then(agentResponseForTool),
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
        manifest: SavedAgentManifestSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ agent_id, description, manifest }) =>
      runTool(() =>
        client.agents
          .update(agent_id, {
            ...(description === undefined ? {} : { description }),
            manifest: manifestForSdk(manifestForSavedAgent(manifest)),
          })
          .then(agentResponseForTool),
      ),
  );
}
