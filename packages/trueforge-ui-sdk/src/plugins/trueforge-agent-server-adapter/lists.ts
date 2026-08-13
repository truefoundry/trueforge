/**
 * Configured-resource list helpers for composer pickers and host boot.
 * Not the settings catalog ports (`catalogs/*`).
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';

export async function listModels(client: TrueForge): Promise<TrueForgeApi.Model[]> {
  const body = await client.models.list();
  return body.data;
}

export async function listConfiguredMcpServers(client: TrueForge): Promise<TrueForgeApi.McpServerReadEntry[]> {
  const body = await client.mcpServers.list();
  return body.data;
}

export async function listSkills(client: TrueForge): Promise<TrueForgeApi.SkillReadEntry[]> {
  const body = await client.skills.list();
  return body.data;
}

export async function getCapabilities(client: TrueForge): Promise<TrueForgeApi.GetCapabilitiesResponseData> {
  const body = await client.server.getCapabilities();
  return body.data;
}
