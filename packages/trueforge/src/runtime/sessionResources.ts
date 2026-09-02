/**
 * Store-backed model/MCP/skill/sandbox resolution for session admit and turns.
 */
import type { AgentSpec } from '@truefoundry/trueforge-core/agent-session';
import {
  Sandbox,
  SkillMounter,
  type AgentDefinition,
  type AgentTracing,
  type GitSkill,
  type ModelParams,
  type RemoteMcpHeaders,
  type SandboxProvider,
  type VercelAIProviderConfig,
} from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { join } from 'node:path';
import type { Logger } from 'winston';
import configuration from '../config';
import type { IMcpServerStore, McpServerRecord } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { ISkillStore } from '../db/skillStore';
import { isMcpAuthRequired, resolveMcpAuth } from '../mcp/auth/mcpDcr';
import type { IOAuthTokenStore } from '../mcp/auth/types';
import { LocalSandboxProvider } from '../sandbox/local/provider/LocalSandboxProvider';
import { getCachedLocalSandboxSupport, isLocalSandboxFallbackEnabled } from '../sandbox/localRuntime';
import { toDaytonaSandboxProvider } from '../sandbox/providerUtils';
import type { ReasoningEffort } from '../schemas/modelProvider';

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
 * Load turn-ready model config and defaults for a configured FQN (`provider/model`).
 * Malformed FQN or missing provider/model → HTTPException(422).
 */

export async function getModelDetails({
  tenant_id,
  name,
  store,
}: {
  tenant_id: string;
  name: string;
  store: IModelProviderStore;
}): Promise<{
  providerConfig: VercelAIProviderConfig;
  defaultModelParams: ModelParams;
  modelProperties: AgentDefinition['modelProperties'];
  reasoningEfforts: ReasoningEffort[] | undefined;
}> {
  const parsed = parseModelFqn(name);
  if (parsed === undefined) {
    throw new HTTPException(422, {
      message: `Model name must be a fully qualified "provider/model": ${name}`,
    });
  }
  const provider = await store.getProvider({ tenant_id, name: parsed.providerName });
  if (provider === undefined) {
    throw new HTTPException(422, {
      message: `Unknown model "${name}" — provider not configured`,
    });
  }
  const model = provider.manifest.models.find(entry => entry.name === parsed.modelName);
  if (model === undefined) {
    throw new HTTPException(422, {
      message: `Unknown model "${name}" — not configured on provider`,
    });
  }
  // Provider types are adapter names, so this assignment is what keeps them so: a type with no
  // `buildLanguageModel` case fails to compile here.
  const { type, base_url: baseUrl } = provider.manifest;
  return {
    providerConfig: {
      provider: { type, name: provider.name },
      model: { id: model.model_id, name: model.name },
      name,
      baseUrl,
      apiKey: provider.manifest.auth?.api_key ?? '',
      headers: {},
    },
    defaultModelParams: model.properties.max_output_tokens ? { max_tokens: model.properties.max_output_tokens } : {},
    modelProperties: { contextLength: model.properties.context_length },
    reasoningEfforts: model.properties.reasoning_efforts,
  };
}

function dcrHeadersResolver(params: {
  record: McpServerRecord;
  tokenStore: IOAuthTokenStore;
  mcpServerStore: IMcpServerStore;
  clientName: string;
  userRef: string;
}): RemoteMcpHeaders {
  const { record, tokenStore, mcpServerStore, clientName, userRef } = params;
  return async () => {
    const result = await resolveMcpAuth({
      tokenStore,
      mcpServerStore,
      serverId: record.id,
      userRef,
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
 * - Local `remote` + `dcr`: resolveMcpAuth via the harness token store.
 * - Otherwise: {@link IMcpServerStore.resolveInvokeHeaders}
 *   (TrueFoundry gateway Bearer, configured header auth, or `{}`).
 * Returns undefined when the server is not registered — callers choose the response.
 */
export async function getMcpConnection({
  tenant_id,
  name,
  store,
  tokenStore,
  clientName,
  userRef,
}: {
  tenant_id: string;
  name: string;
  store: IMcpServerStore;
  tokenStore: IOAuthTokenStore;
  clientName: string;
  userRef: string;
}): Promise<McpConnection | undefined> {
  const record = await store.getServer({ tenant_id, name });
  if (record === undefined) {
    return undefined;
  }
  // TrueFoundry wire `dcr` is Connect UX only — invoke uses store Bearer, not local DCR.
  if (record.manifest.type !== 'truefoundry' && record.manifest.auth?.type === 'dcr') {
    return {
      url: record.manifest.url,
      headers: dcrHeadersResolver({
        record,
        tokenStore,
        mcpServerStore: store,
        clientName,
        userRef,
      }),
    };
  }
  return {
    url: record.manifest.url,
    headers: store.resolveInvokeHeaders(record),
  };
}

/**
 * Expand agent_spec skill names into git mounts from the skill store.
 * Wire url/path/ref/description on the request are ignored — the store row wins.
 * Throws HTTPException(422) if any name is not registered.
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
  if (skills.length === 0) {
    return [];
  }
  const names = skills.map(skill => skill.name);
  const records = await store.listSkills({ tenant_id, names });
  const byName = new Map(records.map(record => [record.name, record]));
  const resolved: GitSkill[] = [];
  for (const skill of skills) {
    const record = byName.get(skill.name);
    if (record === undefined) {
      throw new HTTPException(422, {
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
 * Build a runtime SandboxProvider from the configured store row, or the
 * in-memory local fallback when standalone + the cached probe is supported.
 * Builds a fresh Daytona client per call (no network I/O).
 */
/** Single path segment under the sandboxes parent (`_` when sessionId is missing or unsafe). */
export function localSandboxSessionSegment(sessionId: string | undefined): string {
  if (sessionId === undefined || sessionId.length === 0 || sessionId.includes('/') || sessionId.includes('..')) {
    return '_';
  }
  return sessionId;
}

export async function resolveSandboxProvider({
  tenant_id,
  store,
  logger,
  sessionId,
}: {
  tenant_id: string;
  store: ISandboxProviderStore;
  logger: Logger;
  sessionId: string;
}): Promise<SandboxProvider | undefined> {
  const record = await store.getSandboxProvider(tenant_id);
  if (record !== undefined) {
    // Clone from the snapshot that was actually built (persisted build_ref), not a name
    // derived from the current image — otherwise an image bump breaks creation until rebuild.
    return toDaytonaSandboxProvider({
      manifest: record.manifest,
      tenant_id,
      logger,
      build_metadata: record.build_metadata,
    });
  }
  if (!configuration.STANDALONE) {
    return undefined;
  }
  const support = getCachedLocalSandboxSupport();
  if (support?.supported !== true) {
    return undefined;
  }
  return new LocalSandboxProvider({
    sandboxRootPathParent: join(configuration.LOCAL_SANDBOX_ROOT_PARENT, localSandboxSessionSegment(sessionId)),
    codeModeSocketParentPath: configuration.CODE_MODE_SOCKET_PARENT,
    support,
    fileMaxBytesForDownload: configuration.SANDBOX_FILE_MAX_BYTES_FOR_DOWNLOAD,
    logger,
  });
}

/**
 * Builds a Sandbox for one turn from a resolved provider and git mounts.
 */
export function buildTurnSandbox(input: {
  provider: SandboxProvider;
  logger: Logger;
  gitSkills: readonly GitSkill[];
  fileDownloadEnabled: boolean;
  existingSandboxId?: string | undefined;
  tracing: AgentTracing;
}): Sandbox {
  const skillMounter = input.gitSkills.length > 0 ? new SkillMounter([...input.gitSkills]) : undefined;
  return new Sandbox({
    provider: input.provider,
    existingSandboxId: input.existingSandboxId,
    fileDownloadEnabled: input.fileDownloadEnabled,
    blockDestructiveToolsInCodeMode: true,
    mcpRequestTimeoutMs: configuration.MCP_REQUEST_TIMEOUT_MS,
    mcpConnectTimeoutMs: configuration.MCP_CONNECT_TIMEOUT_MS,
    ...(skillMounter ? { skillMounter } : {}),
    tracing: input.tracing,
    logger: input.logger,
  });
}

/**
 * Cross-checks an AgentSpec against configured models / MCP / skills and
 * sandbox capability. Throws HTTPException(422) for semantic failures.
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
  const resolved = await getModelDetails({
    tenant_id,
    name: spec.model.name,
    store: modelProviderStore,
  });
  const reasoningEffort = spec.model.params?.reasoning_effort;
  if (reasoningEffort !== undefined) {
    const efforts = resolved.reasoningEfforts;
    if (!efforts?.some(effort => effort === reasoningEffort)) {
      throw new HTTPException(422, {
        message: efforts
          ? `Reasoning effort "${reasoningEffort}" is not supported by model "${spec.model.name}"`
          : `Model "${spec.model.name}" does not support configurable reasoning effort`,
      });
    }
  }

  const requestedMcpServers = spec.mcp_servers ?? [];
  if (requestedMcpServers.length > 0) {
    const names = requestedMcpServers.map(server => server.name);
    const configuredNames = new Set(
      (await mcpServerStore.listServers({ tenant_id, names })).map(record => record.name),
    );
    const unknown = requestedMcpServers.find(server => !configuredNames.has(server.name));
    if (unknown !== undefined) {
      throw new HTTPException(422, {
        message: `Unknown MCP server "${unknown.name}" — not configured`,
      });
    }
  }

  const requestedSkills = spec.skills ?? [];
  if (requestedSkills.length > 0) {
    const names = requestedSkills.map(skill => skill.name);
    const configuredNames = new Set((await skillStore.listSkills({ tenant_id, names })).map(record => record.name));
    const unknown = requestedSkills.find(skill => !configuredNames.has(skill.name));
    if (unknown !== undefined) {
      throw new HTTPException(422, {
        message: `Unknown skill "${unknown.name}" — not configured`,
      });
    }
  }

  const wantsSandbox = spec.config.sandbox.enabled;
  const hasSkills = requestedSkills.length > 0;
  if (wantsSandbox || hasSkills) {
    const record = await sandboxProviderStore.getSandboxProvider(tenant_id);
    if (record === undefined && !isLocalSandboxFallbackEnabled()) {
      throw new HTTPException(422, {
        message: hasSkills
          ? 'skills require a sandbox provider — configure via PUT /settings/sandbox-providers'
          : 'sandbox is enabled but no sandbox provider is configured — PUT /settings/sandbox-providers',
      });
    }
  }
}
