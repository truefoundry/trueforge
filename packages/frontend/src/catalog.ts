/** Harness catalog list responses (unauthenticated). */

export interface ModelEntry {
  name: string;
  max_output_tokens?: number;
  reasoning_efforts?: string[];
}

/** Mirrors `McpServerAuthSettingsSchema` in packages/server/src/store/schemas.ts. */
export interface McpServerAuthSettings {
  type: 'dcr';
}

export interface McpServerEntry {
  name: string;
  url: string;
  /** Absent = today's static-header behavior (no OAuth). */
  auth?: McpServerAuthSettings;
}

export interface SkillEntry {
  name: string;
  url: string;
  path?: string;
  ref?: string;
  description: string;
}

export interface ServerCapabilities {
  sandbox: {
    enabled: boolean;
  };
}

interface ListEnvelope<T> {
  data: T[];
}

interface DataEnvelope<T> {
  data: T;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path} failed: ${String(response.status)} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export async function listModels(): Promise<ModelEntry[]> {
  // TODO(AGE-1547): switch catalogs to /api/v1/models (and mcp-servers/skills) when FE leaves legacy.
  const body = await fetchJson<ListEnvelope<ModelEntry>>('/api/v1/legacy/models');
  return body.data;
}

export async function listMcpServers(): Promise<McpServerEntry[]> {
  // TODO(AGE-1547): switch to /api/v1/mcp-servers when FE leaves legacy.
  const body = await fetchJson<ListEnvelope<McpServerEntry>>('/api/v1/legacy/mcp-servers');
  return body.data;
}

export async function listSkills(): Promise<SkillEntry[]> {
  // TODO(AGE-1547): switch to /api/v1/skills when FE leaves legacy.
  const body = await fetchJson<ListEnvelope<SkillEntry>>('/api/v1/legacy/skills');
  return body.data;
}

export async function getCapabilities(): Promise<ServerCapabilities> {
  const body = await fetchJson<DataEnvelope<ServerCapabilities>>('/api/v1/capabilities');
  return body.data;
}
