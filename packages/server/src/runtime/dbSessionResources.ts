/**
 * DB-backed model/MCP/skill resolution for /api/v1/sessions admit and turns.
 */
import type { AgentSpec } from '@truefoundry/utils-core/agent-session';
import {
  isMcpAuthRequired,
  resolveMcpAuth,
  type GitSkill,
  type IOAuthTokenStore,
  type RemoteMcpHeaders,
  type VercelAIProviderConfig,
} from '@truefoundry/utils-core/core';
import { HTTPException } from 'hono/http-exception';
import type { IMcpServerStore, McpServerRecord } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISkillStore } from '../db/skillStore';
import { resolveConfiguredMcpRequestHeaders } from '../schemas/mcpServer';

export interface DbMcpConnection {
  url: string;
  headers: RemoteMcpHeaders;
}

/** Split `provider/model` FQN. Returns undefined when the shape is not exactly one slash. */
export function parseModelFqn(name: string): { providerName: string; modelName: string } | undefined {
  const slash = name.indexOf('/');
  if (slash <= 0 || slash === name.length - 1) {
    return undefined;
  }
  if (name.includes('/', slash + 1)) {
    return undefined;
  }
  return { providerName: name.slice(0, slash), modelName: name.slice(slash + 1) };
}

/**
 * Load turn-ready LLM config for a DB-configured FQN (`provider/model`).
 * Missing provider/model → HTTPException(400) (e.g. deleted after admit).
 * Malformed FQN after admit is an invariant → plain Error (500).
 */
export async function getDbProviderConfig({
  tenant_id,
  name,
  store,
}: {
  tenant_id: string;
  name: string;
  store: IModelProviderStore;
}): Promise<VercelAIProviderConfig> {
  // AgentSpecSchema already required provider/model; failure here is corrupt stored spec.
  const parsed = parseModelFqn(name);
  if (parsed === undefined) {
    throw new Error(`Model name must be a fully qualified "provider/model": ${name}`);
  }
  const provider = await store.getProvider({ tenant_id, name: parsed.providerName });
  if (provider === undefined) {
    throw new HTTPException(400, {
      message: `Unknown model "${name}" — provider not configured`,
    });
  }
  const model = provider.manifest.models.find(entry => entry.name === parsed.modelName);
  if (model === undefined) {
    throw new HTTPException(400, {
      message: `Unknown model "${name}" — not configured on provider`,
    });
  }
  return {
    provider: provider.manifest.type,
    name,
    model_id: model.model_id,
    base_url: provider.manifest.base_url,
    apiKey: provider.manifest.auth.api_key,
    headers: {},
  };
}

function dcrHeadersResolver(params: {
  record: McpServerRecord;
  tokenStore: IOAuthTokenStore;
  mcpServerStore: IMcpServerStore;
  clientName: string;
}): RemoteMcpHeaders {
  const { record, tokenStore, mcpServerStore, clientName } = params;
  return async () => {
    const result = await resolveMcpAuth({
      tokenStore,
      mcpServerStore,
      serverId: record.id,
      mcpServerUrl: record.manifest.url,
      mcpServerName: record.name,
      clientName,
    });
    if (isMcpAuthRequired(result)) {
      // Wire `id` must match RemoteMCP.id (AgentSpec name), not the DB row ULID —
      // init events, tool-call metadata, and snapshots all key by name.
      return {
        authRequired: {
          servers: [{ id: record.name, name: record.name, auth_url: result.authUrl.href }],
        },
      };
    }
    return { headers: result.headers };
  };
}

/**
 * Load MCP url + headers for a DB-configured server.
 * DCR uses resolveMcpAuth; header / no-auth use resolveConfiguredMcpRequestHeaders.
 * Throws HTTPException(400) if the server is not registered.
 */
export async function getDbMcpConnection({
  tenant_id,
  name,
  store,
  tokenStore,
  clientName,
}: {
  tenant_id: string;
  name: string;
  store: IMcpServerStore;
  tokenStore: IOAuthTokenStore;
  clientName: string;
}): Promise<DbMcpConnection> {
  const record = await store.getServer({ tenant_id, name });
  if (record === undefined) {
    throw new HTTPException(400, {
      message: `Unknown MCP server "${name}" — not configured`,
    });
  }
  if (record.manifest.auth?.type === 'dcr') {
    return {
      url: record.manifest.url,
      headers: dcrHeadersResolver({
        record,
        tokenStore,
        mcpServerStore: store,
        clientName,
      }),
    };
  }
  return {
    url: record.manifest.url,
    headers: resolveConfiguredMcpRequestHeaders(record.manifest),
  };
}

/**
 * Expand agent_spec skill names into git mounts from the skill store.
 * Wire url/path/ref/description on the request are ignored — the DB row wins.
 * Throws HTTPException(400) if any name is not registered.
 */
export async function resolveDbGitSkills({
  tenant_id,
  skills,
  store,
}: {
  tenant_id: string;
  skills: readonly { name: string }[];
  store: ISkillStore;
}): Promise<GitSkill[]> {
  const resolved: GitSkill[] = [];
  for (const skill of skills) {
    const record = await store.getSkill({ tenant_id, name: skill.name });
    if (record === undefined) {
      throw new HTTPException(400, {
        message: `Unknown skill "${skill.name}" — not configured`,
      });
    }
    resolved.push({
      name: record.manifest.name,
      description: record.manifest.description,
      url: record.manifest.url,
      path: record.manifest.path ?? '',
      ref: record.manifest.ref,
    });
  }
  return resolved;
}

/**
 * Cross-checks an AgentSpec against DB-configured models / MCP / skills and
 * sandbox capability. Throws HTTPException: 400 unknown refs, 422 missing sandbox.
 * Skills are admitted by name only; mounts expand at turn time.
 */
export async function validateAgentSpecDb({
  spec,
  tenant_id,
  modelProviderStore,
  mcpServerStore,
  skillStore,
  sandboxSupported,
}: {
  spec: AgentSpec;
  tenant_id: string;
  modelProviderStore: IModelProviderStore;
  mcpServerStore: IMcpServerStore;
  skillStore: ISkillStore;
  sandboxSupported: boolean;
}): Promise<void> {
  // FQN shape is enforced by AgentSpecSchema; parse failure here is an invariant.
  const parsed = parseModelFqn(spec.model.name);
  if (parsed === undefined) {
    throw new Error(`Model name must be a fully qualified "provider/model": ${spec.model.name}`);
  }
  const provider = await modelProviderStore.getProvider({ tenant_id, name: parsed.providerName });
  if (provider === undefined) {
    throw new HTTPException(400, {
      message: `Unknown model "${spec.model.name}" — provider not configured`,
    });
  }
  const model = provider.manifest.models.find(entry => entry.name === parsed.modelName);
  if (model === undefined) {
    throw new HTTPException(400, {
      message: `Unknown model "${spec.model.name}" — not configured on provider`,
    });
  }
  const reasoningEffort = spec.model.params?.reasoning_effort;
  if (reasoningEffort !== undefined) {
    const efforts = model.properties.reasoning_efforts;
    if (!efforts?.includes(reasoningEffort)) {
      throw new HTTPException(400, {
        message: efforts
          ? `Reasoning effort "${reasoningEffort}" is not supported by model "${spec.model.name}"`
          : `Model "${spec.model.name}" does not support configurable reasoning effort`,
      });
    }
  }

  for (const server of spec.mcp_servers ?? []) {
    const record = await mcpServerStore.getServer({ tenant_id, name: server.name });
    if (record === undefined) {
      throw new HTTPException(400, {
        message: `Unknown MCP server "${server.name}" — not configured`,
      });
    }
  }

  for (const skill of spec.skills ?? []) {
    const record = await skillStore.getSkill({ tenant_id, name: skill.name });
    if (record === undefined) {
      throw new HTTPException(400, {
        message: `Unknown skill "${skill.name}" — not configured`,
      });
    }
  }

  const wantsSandbox = spec.config?.sandbox?.enabled === true;
  const hasSkills = (spec.skills?.length ?? 0) > 0;
  if ((wantsSandbox || hasSkills) && !sandboxSupported) {
    throw new HTTPException(422, {
      message: hasSkills
        ? 'skills require a sandbox provider — set SANDBOX_SETTINGS (and SANDBOX_API_KEY)'
        : 'sandbox is enabled in the agent spec but this server has no sandbox provider configured — set SANDBOX_SETTINGS (and SANDBOX_API_KEY)',
    });
  }
}
