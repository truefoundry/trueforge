import type { AgentSpec } from './types.js';

/** @deprecated Migrated into chat/agent keys on first read. */
export const DRAFT_SPEC_PREFERENCES_STORAGE_KEY = 'tfy-aui-draft-spec-preferences';
export const CHAT_DRAFT_SPEC_PREFERENCES_STORAGE_KEY = 'tfy-aui-chat-draft-spec-preferences';
export const AGENT_DRAFT_SPEC_PREFERENCES_STORAGE_KEY = 'tfy-aui-agent-draft-spec-preferences';

export type DraftPreferenceKind = 'chat' | 'agent';

type StoredDraftSpecPreferences = {
  version: 1;
  spec: AgentSpec;
};

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function isMountList(value: unknown): boolean {
  return Array.isArray(value) && value.every(isObject);
}

function isAgentSpec(value: unknown): value is AgentSpec {
  if (!isObject(value)) return false;
  const model = Reflect.get(value, 'model');
  if (!isObject(model) || typeof Reflect.get(model, 'name') !== 'string') return false;

  const params = Reflect.get(model, 'params');
  if (params !== undefined && !isObject(params)) return false;

  const skills = Reflect.get(value, 'skills');
  if (skills !== undefined && !isMountList(skills)) return false;

  const mcpServers = Reflect.get(value, 'mcpServers');
  if (mcpServers !== undefined && !isMountList(mcpServers)) return false;

  const config = Reflect.get(value, 'config');
  return config === undefined || isObject(config);
}

function isStoredDraftSpecPreferences(value: unknown): value is StoredDraftSpecPreferences {
  return isObject(value) && Reflect.get(value, 'version') === 1 && isAgentSpec(Reflect.get(value, 'spec'));
}

function storageKeyForKind(kind: DraftPreferenceKind): string {
  return kind === 'chat' ? CHAT_DRAFT_SPEC_PREFERENCES_STORAGE_KEY : AGENT_DRAFT_SPEC_PREFERENCES_STORAGE_KEY;
}

/** New Chat: model (+ reasoning params), skills, and MCP only — no runtime config. */
export function selectChatDraftSpecPreferences(spec: AgentSpec): AgentSpec {
  return {
    model: spec.model,
    ...(spec.skills !== undefined ? { skills: spec.skills } : {}),
    ...(spec.mcpServers !== undefined ? { mcpServers: spec.mcpServers } : {}),
  };
}

/** New Agent: full composer seed including runtime config (sandbox, ask-user, …). */
export function selectAgentDraftSpecPreferences(spec: AgentSpec): AgentSpec {
  return {
    ...selectChatDraftSpecPreferences(spec),
    ...(spec.config !== undefined ? { config: spec.config } : {}),
  };
}

export function selectDraftSpecPreferences(spec: AgentSpec, kind: DraftPreferenceKind): AgentSpec {
  return kind === 'chat' ? selectChatDraftSpecPreferences(spec) : selectAgentDraftSpecPreferences(spec);
}

function readSandboxEnabled(spec: AgentSpec): boolean | undefined {
  if (spec.config === undefined) return undefined;
  // `sandbox` is persisted on draft config but is not part of AgentRuntimeConfig.
  const sandbox = Reflect.get(spec.config, 'sandbox');
  if (!isObject(sandbox)) return undefined;
  const enabled = Reflect.get(sandbox, 'enabled');
  return typeof enabled === 'boolean' ? enabled : undefined;
}

/** Disable sandbox when unavailable; availability must not override the user's runtime choice. */
export function withCapabilitiesSandbox(spec: AgentSpec, sandboxEnabled: boolean | null | undefined): AgentSpec {
  if (sandboxEnabled !== false || readSandboxEnabled(spec) === false) return spec;
  const config = {
    ...spec.config,
    sandbox: { ...spec.config?.sandbox, enabled: false },
  };
  return {
    ...spec,
    config,
  };
}

function readStoredSpec(key: string): AgentSpec | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    return isStoredDraftSpecPreferences(stored) ? stored.spec : null;
  } catch {
    return null;
  }
}

function writeStoredSpec(key: string, spec: AgentSpec): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored: StoredDraftSpecPreferences = { version: 1, spec };
    window.localStorage.setItem(key, JSON.stringify(stored));
    return true;
  } catch {
    // Storage can be unavailable or full; in-memory carry-over still works.
    return false;
  }
}

/** One-shot split of the pre-split shared key into chat + agent stores. */
function migrateLegacyDraftPreferences(): void {
  if (typeof window === 'undefined') return;
  const legacy = readStoredSpec(DRAFT_SPEC_PREFERENCES_STORAGE_KEY);
  if (legacy == null) return;

  const chatReady =
    readStoredSpec(CHAT_DRAFT_SPEC_PREFERENCES_STORAGE_KEY) != null ||
    writeStoredSpec(CHAT_DRAFT_SPEC_PREFERENCES_STORAGE_KEY, selectChatDraftSpecPreferences(legacy));
  const agentReady =
    readStoredSpec(AGENT_DRAFT_SPEC_PREFERENCES_STORAGE_KEY) != null ||
    writeStoredSpec(AGENT_DRAFT_SPEC_PREFERENCES_STORAGE_KEY, selectAgentDraftSpecPreferences(legacy));

  // Keep the legacy key if either destination write failed so a later read can retry.
  if (!chatReady || !agentReady) return;

  try {
    window.localStorage.removeItem(DRAFT_SPEC_PREFERENCES_STORAGE_KEY);
  } catch {
    // Ignore quota / private-mode failures; next read still prefers kind keys.
  }
}

export function readDraftSpecPreferences(kind: DraftPreferenceKind): AgentSpec | null {
  migrateLegacyDraftPreferences();
  const stored = readStoredSpec(storageKeyForKind(kind));
  return stored == null ? null : selectDraftSpecPreferences(stored, kind);
}

export function writeDraftSpecPreferences(kind: DraftPreferenceKind, spec: AgentSpec): void {
  writeStoredSpec(storageKeyForKind(kind), selectDraftSpecPreferences(spec, kind));
}
