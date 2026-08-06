/**
 * Configured-resource list helpers for composer pickers and app boot.
 * Not the settings catalog ports (`*Catalog.ts`).
 */
import type { TrueForgeApi as Harness } from 'trueforge';
import { harnessClient as client } from './harnessClient';

export async function listModels(): Promise<Harness.Model[]> {
  const body = await client.models.list();
  return body.data;
}

export async function listMcpServers(): Promise<Harness.McpServerReadEntry[]> {
  const body = await client.mcpServers.list();
  return body.data;
}

export async function listSkills(): Promise<Harness.SkillReadEntry[]> {
  const body = await client.skills.list();
  return body.data;
}

export async function getCapabilities(): Promise<Harness.GetCapabilitiesResponseData> {
  const body = await client.server.getCapabilities();
  return body.data;
}
