/**
 * Configured-resource list helpers for composer pickers and app boot.
 * Not the settings catalog ports (`*Catalog.ts`).
 */
import type { TrueForgeApi } from 'trueforge-sdk';
import { harnessClient as client } from './harnessClient';

export async function listModels(): Promise<TrueForgeApi.Model[]> {
  const body = await client.models.list();
  return body.data;
}
export async function listConfiguredMcpServers(): Promise<TrueForgeApi.ConfiguredMcpServer[]> {
  const body = await client.settings.mcpServers.list();
  return body.data;
}

export async function listSkills(): Promise<TrueForgeApi.SkillReadEntry[]> {
  const body = await client.skills.list();
  return body.data;
}

export async function getCapabilities(): Promise<TrueForgeApi.GetCapabilitiesResponseData> {
  const body = await client.server.getCapabilities();
  return body.data;
}
