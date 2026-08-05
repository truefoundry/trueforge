/**
 * Store-backed model/MCP/skill/sandbox resolution for session admit and turns.
 */
import { Daytona } from '@daytona/sdk';
import type { AgentSpec } from '@truefoundry/utils-core/agent-session';
import {
  DaytonaSandboxProvider,
  isMcpAuthRequired,
  resolveMcpAuth,
  Sandbox,
  SkillMounter,
  type AgentTracing,
  type GitSkill,
  type IOAuthTokenStore,
  type RemoteMcpHeaders,
  type SandboxProvider,
  type VercelAIProviderConfig,
} from '@truefoundry/utils-core/core';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'winston';
import configuration from '../config';
import type { IMcpServerStore, McpServerRecord } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { ISkillStore } from '../db/skillStore';
import { resolveConfiguredMcpRequestHeaders } from '../schemas/mcpServer';
import { PROVIDER_DEFAULT_BASE_URLS } from '../schemas/modelProvider';
import { toDaytonaSandboxProviderInput } from '../schemas/sandboxProvider';

export interface McpConnection {
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
 * Load turn-ready LLM config for a configured FQN (`provider/model`).
 * Missing provider/model → HTTPException(400) (e.g. deleted after admit).
 * Malformed FQN after admit is an invariant → plain Error (500).
 */
export async function getProviderConfig({
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
  // Provider types are adapter names, so this assignment is what keeps them so: a type with no
  // `buildLanguageModel` case fails to compile here. An explicit base_url always wins.
  const { type, base_url } = provider.manifest;
  return {
    provider: type,
    name,
    modelId: model.model_id,
    baseUrl: base_url ?? PROVIDER_DEFAULT_BASE_URLS[type],
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
 * Load MCP url + headers for a configured server.
 * DCR uses resolveMcpAuth; header / no-auth use resolveConfiguredMcpRequestHeaders.
 * Throws HTTPException(400) if the server is not registered.
 */
export async function getMcpConnection({
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
}): Promise<McpConnection> {
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
 * Wire url/path/ref/description on the request are ignored — the store row wins.
 * Throws HTTPException(400) if any name is not registered.
 */
export async function resolveGitSkills({
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
 * Build a runtime SandboxProvider from the configured store row, or undefined
 * when no provider is configured. Builds a fresh Daytona client per call (no network I/O).
 */
export async function resolveSandboxProvider({
  tenant_id,
  store,
  logger,
}: {
  tenant_id: string;
  store: ISandboxProviderStore;
  logger: Logger;
}): Promise<SandboxProvider | undefined> {
  const record = await store.getSandboxProvider(tenant_id);
  if (record === undefined) {
    return undefined;
  }
  const { apiKey, ...settings } = toDaytonaSandboxProviderInput(record.manifest);
  return new DaytonaSandboxProvider({
    client: new Daytona({ apiKey }),
    ...settings,
    tenantName: tenant_id,
    fileMaxBytesForDownload: configuration.SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD,
    logger,
  });
}

/**
 * Builds a Sandbox for one turn from a resolved provider and git mounts.
 * `tenantName` must match the name given to DaytonaSandboxProvider (ownership check).
 */
export function buildTurnSandbox(input: {
  provider: SandboxProvider;
  logger: Logger;
  gitSkills: readonly GitSkill[];
  fileDownloadEnabled: boolean;
  existingSandboxId?: string | undefined;
  tracing: AgentTracing;
  tenantName: string;
}): Sandbox {
  const skillMounter = input.gitSkills.length > 0 ? new SkillMounter([...input.gitSkills]) : undefined;
  return new Sandbox({
    provider: input.provider,
    existingSandboxId: input.existingSandboxId,
    fileDownloadEnabled: input.fileDownloadEnabled,
    blockDestructiveToolsInCodeMode: true,
    mcpRequestTimeoutMs: configuration.MCP_REQUEST_TIMEOUT_MS,
    mcpConnectTimeoutMs: configuration.MCP_CONNECT_TIMEOUT_MS,
    // Sandbox reads its tenant from TFY_TENANT_NAME for the ownership check
    // against provider-created sandbox ids (`<tenant>.<uuid>`).
    execExtraEnv: { TFY_TENANT_NAME: input.tenantName },
    ...(skillMounter ? { skillMounter } : {}),
    tracing: input.tracing,
    logger: input.logger,
  });
}

/**
 * Cross-checks an AgentSpec against configured models / MCP / skills and
 * sandbox capability. Throws HTTPException: 400 unknown refs, 422 missing sandbox.
 * Skills are admitted by name only; mounts expand at turn time.
 */
export async function validateAgentSpec({
  spec,
  tenant_id,
  modelProviderStore,
  mcpServerStore,
  skillStore,
  sandboxProviderStore,
}: {
  spec: AgentSpec;
  tenant_id: string;
  modelProviderStore: IModelProviderStore;
  mcpServerStore: IMcpServerStore;
  skillStore: ISkillStore;
  sandboxProviderStore: ISandboxProviderStore;
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
  if (wantsSandbox || hasSkills) {
    const record = await sandboxProviderStore.getSandboxProvider(tenant_id);
    if (record === undefined) {
      throw new HTTPException(422, {
        message: hasSkills
          ? 'skills require a sandbox provider — configure via PUT /settings/sandbox-providers'
          : 'sandbox is enabled but no sandbox provider is configured — PUT /settings/sandbox-providers',
      });
    }
  }
}
