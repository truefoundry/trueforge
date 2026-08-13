/**
 * AgentBuilderServer callbacks for createTrueFoundryServer.
 * Composer pickers + agent library backed by the Harness agents registry.
 */
import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type {
  AgentBuilderServer,
  AgentLibraryEntry,
  ModelSelection,
  SearchAgentsParams,
} from '@truefoundry/trueforge-ui';
import { listConfiguredMcpServers, listSkills } from './composerLists';
import { toUiConnectorFromReadEntry } from './connectorCatalog';
import { createHarnessClient, harnessClient, type CreateHarnessClientOptions } from './harnessClient';
import { agentManifest, toHarnessAgentSpec, toUiAgentSpec, type HarnessAgentSpec } from './harnessServer';

/** Well-known catalog entries key logos by `type` (same as configured provider resource name). */
export function modelProviderLogosByName(
  catalog: readonly TrueForgeApi.CatalogModelProvider[],
): ReadonlyMap<string, string> {
  const logos = new Map<string, string>();
  for (const entry of catalog) {
    if (entry.type === 'custom' || entry.logo === undefined) {
      continue;
    }
    logos.set(entry.type, entry.logo);
  }
  return logos;
}

/** Map harness model rows onto the UI picker shape (nested provider + properties + optional logo). */
export function toModelSelection({ model, logo }: { model: TrueForgeApi.Model; logo?: string }): ModelSelection {
  const efforts = model.properties.reasoningEfforts;
  return {
    id: model.modelId,
    name: model.name,
    provider: {
      name: model.provider.name,
      ...(logo === undefined ? {} : { logo }),
    },
    properties: {
      ...(efforts !== undefined && efforts.length > 0 ? { reasoningEfforts: [...efforts] } : {}),
    },
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
    getModels: async () => {
      // Catalog logos are optional UI enrichment — a catalog failure must not blank the picker.
      const [modelsBody, catalogEntries] = await Promise.all([
        client.models.list(),
        client.catalog.modelProviders.list().then(
          body => body.data,
          () => [],
        ),
      ]);
      const logosByName = modelProviderLogosByName(catalogEntries);
      return modelsBody.data.map(model => {
        const logo = logosByName.get(model.provider.name);
        return toModelSelection(logo === undefined ? { model } : { model, logo });
      });
    },
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

    async saveAgent({ agentName, agentSpec, intent }) {
      const manifest = toHarnessAgentSpec(agentSpec);
      if (intent === 'update') {
        const { data } = await client.agents.list();
        const existing = data.find(agent => agent.name === agentName);
        await client.agents.update(agentName, manifest);
        return existing === undefined ? {} : { agentId: existing.id };
      }
      const created = await client.agents.create({ name: agentName, ...manifest });
      return { agentId: created.data.id };
    },
  };
}
