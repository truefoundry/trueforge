import type { AgentSpec } from '@truefoundry/trueforge-core/agent-session';
import {
  Sandbox,
  SkillMounter,
  type AgentDefinition,
  type AgentTracing,
  type DaytonaSandboxEnvironment,
  type ModelParams,
  type RemoteMcpHeaders,
  type SandboxProvider,
  type Skill,
  type VercelAIProviderConfig,
} from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { join } from 'node:path';
import type { Logger } from 'winston';
import configuration from '../config';
import type { IMcpServerStore, IMcpServerWithAuthStore } from '../db/mcpServerStore';
import type { IModelProviderStore } from '../db/modelProviderStore';
import type { ISandboxEnvironmentStore } from '../db/sandboxEnvironmentStore';
import type { ISandboxProviderStore } from '../db/sandboxProviderStore';
import type { ISkillStore } from '../db/skillStore';
import type { TurnMetadata } from '../db/turnMetadata';
import type { IWebSearchProviderStore } from '../db/webSearchProviderStore';
import { LocalSandboxProvider } from '../sandbox/local/provider/LocalSandboxProvider';
import { getCachedLocalSandboxSupport, isLocalSandboxFallbackEnabled } from '../sandbox/localRuntime';
import {
  toSandboxEnvironment,
  toSandboxProviderFromRecord,
  type ResolvedSandboxProvider,
} from '../sandbox/providerUtils';
import type { ReasoningEffort } from '../schemas/modelProvider';
import { DEFAULT_SANDBOX_ENVIRONMENT_NAME } from '../schemas/sandboxEnvironment';
import { hasConfiguredWebSearchProvider } from '../websearch/providers';

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
  turnMetadata,
}: {
  tenant_id: string;
  name: string;
  store: IModelProviderStore;
  turnMetadata?: TurnMetadata;
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
  const provider = await store.getProvider({
    tenant_id,
    name: parsed.providerName,
    model_name: parsed.modelName,
  });
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
      headers: turnMetadata === undefined ? {} : await store.resolveInvokeHeaders({ record: provider, turnMetadata }),
    },
    defaultModelParams: model.properties.max_output_tokens ? { max_tokens: model.properties.max_output_tokens } : {},
    modelProperties: { contextLength: model.properties.context_length },
    reasoningEfforts: model.properties.reasoning_efforts,
  };
}

/**
 * Load MCP url + headers for a configured server. Returns undefined when unregistered.
 *
 * TODO: OAuth header resolvers re-run on every RemoteMCP listTools/callTool; cache or gate later.
 */
export async function getMcpConnection({
  tenant_id,
  name,
  store,
  userRef,
  turnMetadata,
}: {
  tenant_id: string;
  name: string;
  store: IMcpServerWithAuthStore;
  userRef: string;
  turnMetadata?: TurnMetadata;
}): Promise<McpConnection | undefined> {
  const record = await store.getServer({ tenant_id, name });
  if (record === undefined) {
    return undefined;
  }
  return {
    url: record.manifest.url,
    headers: store.resolveInvokeHeaders({
      record,
      userRef,
      ...(turnMetadata === undefined ? {} : { turnMetadata }),
    }),
  };
}

/** Single path segment under the sandboxes parent (`_` when sessionId is missing or unsafe). */
export function localSandboxSessionSegment(sessionId: string | undefined): string {
  if (sessionId === undefined || sessionId.length === 0 || sessionId.includes('/') || sessionId.includes('..')) {
    return '_';
  }
  return sessionId;
}

/**
 * Configured provider client, or standalone local fallback.
 * Fresh client per call (no network I/O until a provider method runs).
 * Environment is resolved separately via resolveSandboxEnvironment.
 */
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
}): Promise<ResolvedSandboxProvider | LocalSandboxProvider | undefined> {
  const record = await store.getSandboxProvider(tenant_id);
  if (record !== undefined) {
    return toSandboxProviderFromRecord({ record, tenant_id, logger });
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
 * Load a ready sandbox environment for create. Throws 422 when missing or not ready.
 * When `optional` is true, a missing environment returns undefined instead of 422.
 */
export async function resolveSandboxEnvironment({
  tenant_id,
  name,
  sandboxEnvironmentStore,
  optional = false,
}: {
  tenant_id: string;
  name: string;
  sandboxEnvironmentStore: ISandboxEnvironmentStore;
  optional?: boolean;
}): Promise<DaytonaSandboxEnvironment | undefined> {
  const loaded = await sandboxEnvironmentStore.getEnvironment({
    tenant_id,
    name,
  });
  if (loaded === undefined) {
    if (optional) {
      return undefined;
    }
    throw new HTTPException(422, {
      message: `Unknown sandbox environment "${name}" — not configured`,
    });
  }
  if (loaded.version.status !== 'ready') {
    throw new HTTPException(422, {
      message:
        loaded.version.status === 'failed'
          ? `Sandbox environment "${name}" build failed (${loaded.version.status_reason ?? 'unknown error'})`
          : `Sandbox environment "${name}" is not ready (status: ${loaded.version.status}) — retry shortly`,
    });
  }
  return toSandboxEnvironment({
    external_ref: loaded.version.external_ref,
    manifest: loaded.version.manifest,
  });
}

/**
 * Builds a Sandbox for one turn from a resolved provider, optional environment, and skill mounts.
 */
export function buildTurnSandbox<TEnvironment = undefined>(input: {
  provider: SandboxProvider<TEnvironment>;
  environment?: TEnvironment | undefined;
  logger: Logger;
  skills?: readonly Skill[];
  fileDownloadEnabled: boolean;
  existingSandboxId?: string | undefined;
  tracing: AgentTracing;
}): Sandbox<TEnvironment> {
  // Empty mounter still uploads requested-skills file so existing skills are cleaned up.
  return new Sandbox({
    provider: input.provider,
    ...(input.environment !== undefined ? { environment: input.environment } : {}),
    existingSandboxId: input.existingSandboxId,
    fileDownloadEnabled: input.fileDownloadEnabled,
    blockDestructiveToolsInCodeMode: true,
    mcpRequestTimeoutMs: configuration.MCP_REQUEST_TIMEOUT_MS,
    mcpConnectTimeoutMs: configuration.MCP_CONNECT_TIMEOUT_MS,
    skillMounter: new SkillMounter({ skills: input.skills ?? [] }),
    tracing: input.tracing,
    logger: input.logger,
  });
}

/**
 * Cross-checks an AgentSpec against configured models / MCP / skills and
 * sandbox capability. Throws HTTPException(422) for semantic failures.
 * Skills must exist in the skill store (git name) or pass SFY resolve (registry FQN).
 */
export async function validateAgentSpec({
  spec,
  tenant_id,
  created_by_subject_id,
  modelProviderStore,
  mcpServerStore,
  skillStore,
  sandboxProviderStore,
  sandboxEnvironmentStore,
  webSearchProviderStore,
}: {
  spec: AgentSpec;
  tenant_id: string;
  created_by_subject_id: string;
  modelProviderStore: IModelProviderStore;
  mcpServerStore: IMcpServerStore;
  skillStore: ISkillStore;
  sandboxProviderStore: ISandboxProviderStore;
  sandboxEnvironmentStore: ISandboxEnvironmentStore;
  webSearchProviderStore: IWebSearchProviderStore;
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
      (
        await mcpServerStore.listServers({
          tenant_id,
          names,
        })
      ).map(record => record.name),
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
    await skillStore.validateAgentSkills({ tenant_id, skills: requestedSkills });
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

  const environmentName = spec.config.sandbox.environment_name;
  if (environmentName && environmentName !== DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
    const environment = await sandboxEnvironmentStore.getEnvironment({
      tenant_id,
      name: environmentName,
      created_by_subject_id,
    });
    if (environment === undefined) {
      throw new HTTPException(422, {
        message: `Unknown sandbox environment "${environmentName}" — not configured`,
      });
    }
  }

  if (spec.config.web_search.enabled) {
    const hasProvider = await hasConfiguredWebSearchProvider({ tenant_id, store: webSearchProviderStore });
    if (!hasProvider) {
      throw new HTTPException(422, {
        message: 'web_search is enabled but no web-search provider is configured',
      });
    }
  }
}
