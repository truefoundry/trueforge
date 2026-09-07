/**
 * AgentBuilderServer callbacks for createTrueFoundryServer.
 * Composer pickers + agent library backed by the Harness agents registry.
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type {
  AgentBuilderServer,
  AgentLibraryEntry,
  ModelSelection,
  PageParams,
  SearchAgentsParams,
} from '../../server/types.js';
import { toUiConnectorFromReadEntry, toUiTool } from './catalogs/connectorCatalog.js';
import { toHarnessAgentSpec, toUiAgentSpec } from './chatServer.js';
import { createTrueForgeClient, type CreateTrueForgeClientOptions } from './client.js';
import { listConfiguredMcpServers, listConfiguredMcpServersPage, listSkills } from './lists.js';
import type { HarnessAgentSpec } from './types.js';

export type CreateHarnessBuilderServerOptions = CreateTrueForgeClientOptions & {
  client?: TrueForge;
};

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
export function toModelSelection({
  model,
  logo,
}: {
  model: TrueForgeApi.AvailableModel;
  logo?: string;
}): ModelSelection {
  const { contextLength, maxOutputTokens, reasoningEfforts } = model.properties;
  return {
    id: model.modelId,
    name: model.name,
    provider: {
      name: model.provider.name,
      ...(logo === undefined ? {} : { logo }),
    },
    properties: {
      ...(contextLength === undefined ? {} : { contextLength }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...(reasoningEfforts === undefined ? {} : { reasoningEfforts: [...reasoningEfforts] }),
    },
  };
}

function toLibraryEntry(agent: TrueForgeApi.Agent): AgentLibraryEntry {
  return {
    name: agent.name,
    agentId: agent.id,
    agentSpec: toUiAgentSpec(agent.manifest),
  };
}

export function createHarnessBuilderServer(
  options: CreateHarnessBuilderServerOptions = {},
): AgentBuilderServer<HarnessAgentSpec> {
  const client = options.client ?? createTrueForgeClient(options);

  return {
    getCapabilities: () => client.server.getCapabilities(),
    getModels: async () => {
      // Catalog logos are optional UI enrichment — a catalog failure must not blank the picker.
      const [modelsBody, catalogEntries] = await Promise.all([
        client.models.list(),
        client.catalogs.modelProviders.list().then(
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
      const skills = await listSkills(client);
      return skills.map(skill => ({ id: skill.name, name: skill.name, description: skill.description }));
    },
    getMcp: async () => (await listConfiguredMcpServers(client)).map(toUiConnectorFromReadEntry),
    listMcp: async (req?: PageParams) => {
      const page = await listConfiguredMcpServersPage(client, req ?? {});
      return {
        data: page.data.map(toUiConnectorFromReadEntry),
        ...(page.nextPageToken === undefined ? {} : { nextPageToken: page.nextPageToken }),
      };
    },
    getMcpTools: async ({ connectorId }: { connectorId: string }) => {
      const body = await client.mcpServers.listTools(connectorId);
      return body.data.flatMap(tool =>
        typeof tool.name === 'string' && tool.name.trim() !== '' ? [toUiTool(tool)] : [],
      );
    },

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
        if (!existing) {
          return {};
        }
        await client.agents.update(existing.id, { manifest });
        return { agentId: existing.id };
      }
      const created = await client.agents.create({ name: agentName, manifest });
      return { agentId: created.data.id };
    },

    async deleteAgent({ agentName }) {
      const { data } = await client.agents.list();
      const existing = data.find(agent => agent.name === agentName);
      if (!existing) return;
      await client.agents.delete(existing.id);
    },
  };
}
