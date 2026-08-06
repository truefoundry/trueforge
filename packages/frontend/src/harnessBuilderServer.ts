/**
 * AgentBuilderServer callbacks for createTrueFoundryServer.
 * Composer pickers + agent registry (list / create-only save).
 */
import type { AgentBuilderServer } from '@truefoundry/trueforge-ui';
import { TrueForgeApi as Harness } from 'trueforge';
import { getCapabilities, listMcpServers, listModels, listSkills } from './composerLists';
import { createHarnessClient, harnessClient, type CreateHarnessClientOptions } from './harnessClient';
import { toHarnessAgentSpec, type HarnessAgentSpec } from './harnessServer';

/** Harness model names are `provider/model`. */
export function providerOf(name: string): string {
  return name.split('/')[0] ?? name;
}

export type CreateHarnessBuilderServerOptions = CreateHarnessClientOptions;

export function createHarnessBuilderServer(
  options: CreateHarnessBuilderServerOptions = {},
): AgentBuilderServer<HarnessAgentSpec> {
  const client =
    options.baseUrl === undefined && options.fetch === undefined ? harnessClient : createHarnessClient(options);

  return {
    getModels: async () => (await listModels()).map(model => ({ name: model.name, provider: providerOf(model.name) })),
    // Skills require a configured sandbox provider; keep the picker empty when skill capability is off.
    getSkills: async () => {
      const [capabilities, skills] = await Promise.all([getCapabilities(), listSkills()]);
      return capabilities.skill.enabled
        ? skills.map(skill => ({ id: skill.name, name: skill.name, description: skill.description }))
        : [];
    },
    getMcp: async () =>
      (await listMcpServers()).map(server => ({ id: server.name, name: server.name, description: server.url })),
    async searchAgents(req = {}) {
      const limit = req.limit ?? 50;
      const query = req.query?.trim().toLowerCase();
      const { data } = await client.agents.list();
      const names = data.map(agent => ({ name: agent.name }));
      const filtered =
        query === undefined || query.length === 0
          ? names
          : names.filter(agent => agent.name.toLowerCase().includes(query));
      return filtered.slice(0, limit);
    },
    async saveAgent({ agentName, agentSpec }) {
      try {
        const created = await client.agents.create({
          name: agentName,
          ...toHarnessAgentSpec(agentSpec),
        });
        return { name: created.data.name };
      } catch (error: unknown) {
        if (error instanceof Harness.ConflictError) {
          throw new Error(`An agent named "${agentName}" already exists`, { cause: error });
        }
        throw error;
      }
    },
  };
}
