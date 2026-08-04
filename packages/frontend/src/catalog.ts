/** DB-backed catalog list helpers for the composer pickers and boot. */
import type { TrueHarnessApi as Harness } from 'trueharness';
import { TrueHarness } from 'trueharness';

const client = new TrueHarness({ baseUrl: '/' });

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
