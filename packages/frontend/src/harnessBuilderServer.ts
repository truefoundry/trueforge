/**
 * AgentBuilderServer callbacks for createTrueFoundryServer.
 * Composer pickers + agent library backed by the Harness agents registry.
 */
import type {
  AgentBuilderServer,
  AgentLibraryEntry,
  ModelSelection,
  SearchAgentsParams,
} from '@truefoundry/trueforge-ui';
import type { TrueForgeApi } from 'trueforge-sdk';
import { listConfiguredMcpServers, listModels, listSkills } from './composerLists';
import { toUiConnectorFromReadEntry } from './connectorCatalog';
import { createHarnessClient, harnessClient, type CreateHarnessClientOptions } from './harnessClient';
import { agentManifest, toHarnessAgentSpec, toUiAgentSpec, type HarnessAgentSpec } from './harnessServer';

/** Harness model names are `provider/model`. */
export function providerOf(name: string): string {
  return name.split('/')[0] ?? name;
}

/** Map harness model rows onto the UI picker shape (incl. reasoning-effort options). */
export function toModelSelection(model: TrueForgeApi.Model): ModelSelection {
  const efforts = model.properties.reasoningEfforts;
  return {
    name: model.name,
    provider: providerOf(model.name),
    ...(efforts !== undefined && efforts.length > 0 ? { reasoningEfforts: [...efforts] } : {}),
  };
}

function toLibraryEntry(agent: TrueForgeApi.Agent): AgentLibraryEntry {
  return {
    name: agent.name,
    agentId: agent.id,
    agentSpec: toUiAgentSpec(agentManifest(agent)),
  };
}

export function createHarnessBuilderServer(
  options: CreateHarnessClientOptions = {},
): AgentBuilderServer<HarnessAgentSpec> {
  const client =
    options.baseUrl === undefined && options.fetch === undefined ? harnessClient : createHarnessClient(options);

  return {
    getCapabilities: () => client.server.getCapabilities(),
    getModels: async () => (await listModels()).map(toModelSelection),
    // Skills require a configured sandbox provider; keep the picker empty when skill capability is off.
    getSkills: async () => {
      const skills = await listSkills();
      return skills.map(skill => ({ id: skill.name, name: skill.name, description: skill.description }));
    },
    getMcp: async () => (await listConfiguredMcpServers()).map(toUiConnectorFromReadEntry),

    async searchAgents(req?: SearchAgentsParams) {
      const { data } = await client.agents.list();
      const query = req?.query?.trim().toLowerCase();
      const filtered =
        query === undefined || query === '' ? data : data.filter(agent => agent.name.toLowerCase().includes(query));
      const offset = req?.offset ?? 0;
      const limit = req?.limit ?? 50;
      return filtered.slice(offset, offset + limit).map(toLibraryEntry);
    },

    async saveAgent({ agentName, agentSpec }) {
      const manifest = toHarnessAgentSpec(agentSpec);
      const { data } = await client.agents.list();
      const existing = data.find(agent => agent.name === agentName);
      if (existing !== undefined) {
        await client.agents.update(agentName, manifest);
        return { ok: true as const, updated: true as const, agentId: existing.id };
      }
      const created = await client.agents.create({ name: agentName, ...manifest });
      return { ok: true as const, updated: false as const, agentId: created.data.id };
    },
  };
}
