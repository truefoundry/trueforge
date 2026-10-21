import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import { z } from 'zod';
import { runTool } from '../result';

export function registerSkillTools(server: McpServer, client: TrueForge): void {
  server.registerTool(
    'list_skills',
    {
      description:
        'List the skills you can add to an agent, each with its name and description. Use it to find a skill ' +
        'to reference in a manifest.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => runTool(() => client.skills.list()),
  );

  server.registerTool(
    'list_skill_versions',
    {
      description:
        'List the available versions of a skill so you can pin a specific version when referencing it in an agent manifest.',
      inputSchema: { name: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => runTool(() => client.skills.listVersions({ name })),
  );
}
