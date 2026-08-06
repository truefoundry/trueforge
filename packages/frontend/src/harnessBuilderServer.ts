/**
 * AgentBuilderServer callbacks for createTrueFoundryServer.
 * Composer pickers + agent library stubs (Harness has no agent registry).
 */
import type { AgentBuilderServer } from '@truefoundry/trueforge-ui';
import { getCapabilities, listMcpServers, listModels, listSkills } from './composerLists';
import type { HarnessAgentSpec } from './harnessServer';

/** Harness model names are `provider/model`. */
export function providerOf(name: string): string {
  return name.split('/')[0] ?? name;
}

export function createHarnessBuilderServer(): AgentBuilderServer<HarnessAgentSpec> {
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
    searchAgents: () => Promise.resolve([]),
    saveAgent: () => Promise.reject(new Error('Harness has no agent registry — sessions are draft-only')),
  };
}
