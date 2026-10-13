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

function readSandboxEnabled(spec: AgentSpec): boolean | undefined {
  if (spec.config === undefined) return undefined;
  // `sandbox` is persisted on draft config but is not part of AgentRuntimeConfig.
  const sandbox = Reflect.get(spec.config, 'sandbox');
  if (!isObject(sandbox)) return undefined;
  const enabled = Reflect.get(sandbox, 'enabled');
  return typeof enabled === 'boolean' ? enabled : undefined;
}

function readWebSearchEnabled(spec: AgentSpec): boolean | undefined {
  if (spec.config?.webSearch === undefined) return undefined;
  const enabled = spec.config.webSearch.enabled;
  return typeof enabled === 'boolean' ? enabled : undefined;
}

/**
 * New Chat: model (+ reasoning params), skills, MCP, and the web-search toggle.
 * Other runtime config (sandbox, ask-user, …) is not persisted for chat.
 */
export function selectChatDraftSpecPreferences(spec: AgentSpec): AgentSpec {
  const webSearchEnabled = readWebSearchEnabled(spec);
  return {
    model: spec.model,
    ...(spec.skills !== undefined ? { skills: spec.skills } : {}),
    ...(spec.mcpServers !== undefined ? { mcpServers: spec.mcpServers } : {}),
    ...(webSearchEnabled !== undefined ? { config: { webSearch: { enabled: webSearchEnabled } } } : {}),
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

/**
 * Align `config.webSearch` with host capability.
 * - unavailable → force false on the live draft (do not persist — see `withoutWebSearchPreference`)
 * - available → fill true only when the key is absent (preserve explicit user toggles)
 */
export function withCapabilitiesWebSearch({
  spec,
  webSearchEnabled,
}: {
  spec: AgentSpec;
  webSearchEnabled: boolean | null | undefined;
  /** Kept for call-site compatibility; chat and agent share the same fill/preserve rules. */
  kind?: DraftPreferenceKind;
}): AgentSpec {
  if (webSearchEnabled == null) return spec;

  if (webSearchEnabled === false) {
    if (readWebSearchEnabled(spec) === false) return spec;
    return {
      ...spec,
      config: {
        ...spec.config,
        webSearch: { ...spec.config?.webSearch, enabled: false },
      },
    };
  }

  // Only default true when the field is missing — chat and agent both keep user toggles.
  if (spec.config?.webSearch !== undefined) return spec;
  return {
    ...spec,
    config: {
      ...spec.config,
      webSearch: { enabled: true },
    },
  };
}

/** Drop webSearch so a capability-forced off is not stored as a user preference. */
export function withoutWebSearchPreference(spec: AgentSpec): AgentSpec {
  if (spec.config?.webSearch === undefined) return spec;
  const { webSearch: _ignored, ...restConfig } = spec.config;
  if (Object.keys(restConfig).length === 0) {
    const { config: _config, ...rest } = spec;
    return rest;
  }
  return { ...spec, config: restConfig };
}

/**
 * When web-search flips unavailable → available, a live `enabled: false` may be leftover
 * force-off. Default-fill on only when that false is not an explicit user/saved choice.
 */
export function recoverWebSearchAfterCapabilityAvailable({
  spec,
  previousWebSearchEnabled,
  webSearchEnabled,
  explicitOff = false,
  kind,
}: {
  spec: AgentSpec;
  previousWebSearchEnabled: boolean | null | undefined;
  webSearchEnabled: boolean | null | undefined;
  /** Saved or previously persisted off — not a capability-forced value. */
  explicitOff?: boolean;
  kind?: DraftPreferenceKind;
}): AgentSpec {
  if (explicitOff) return spec;
  if (previousWebSearchEnabled !== false || webSearchEnabled !== true) return spec;
  if (readWebSearchEnabled(spec) !== false) return spec;
  return withCapabilitiesWebSearch({
    spec: withoutWebSearchPreference(spec),
    webSearchEnabled: true,
    kind,
  });
}

function withWebSearchEnabled(spec: AgentSpec, enabled: boolean): AgentSpec {
  if (readWebSearchEnabled(spec) === enabled) return spec;
  return {
    ...spec,
    config: {
      ...spec.config,
      webSearch: { ...spec.config?.webSearch, enabled },
    },
  };
}

export function persistedWebSearchEnabled(kind: DraftPreferenceKind): boolean | undefined {
  const stored = readDraftSpecPreferences(kind);
  return stored == null ? undefined : readWebSearchEnabled(stored);
}

/**
 * Remember a user web-search choice. Capability-forced off is omitted unless a choice
 * was already stored, and that stored off is not rewritten to on when search returns.
 */
export function webSearchPreferenceToStore({
  spec,
  webSearchEnabled,
  previousWebSearchEnabled,
  kind,
}: {
  spec: AgentSpec;
  webSearchEnabled: boolean | null | undefined;
  previousWebSearchEnabled: boolean | null | undefined;
  kind: DraftPreferenceKind;
}): AgentSpec {
  const persistedEnabled = persistedWebSearchEnabled(kind);
  if (webSearchEnabled === false) {
    const stripped = withoutWebSearchPreference(spec);
    return persistedEnabled === undefined ? stripped : withWebSearchEnabled(stripped, persistedEnabled);
  }
  return recoverWebSearchAfterCapabilityAvailable({
    spec,
    previousWebSearchEnabled,
    webSearchEnabled,
    explicitOff: persistedEnabled === false,
    kind,
  });
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
