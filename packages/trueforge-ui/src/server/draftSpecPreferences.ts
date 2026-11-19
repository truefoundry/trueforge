import { readDraftTrueforgeEnabled } from '@truefoundry/trueforge-assistant-ui-runtime/server';
import type { AgentRuntimeConfig, AgentSpec } from './types.js';

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

function readTrimmedString(value: object, key: string): string {
  const raw = Reflect.get(value, key);
  return typeof raw === 'string' ? raw.trim() : '';
}

type SandboxConfig = NonNullable<AgentRuntimeConfig['sandbox']>;

/** The environment the spec names, or undefined when it names none. */
export function readSandboxEnvironmentName(sandbox: object | undefined): string | undefined {
  if (!isObject(sandbox)) return undefined;
  const camelName = readTrimmedString(sandbox, 'environmentName');
  if (camelName.length > 0) return camelName;
  const snakeName = readTrimmedString(sandbox, 'environment_name');
  return snakeName.length > 0 ? snakeName : undefined;
}

/** Set the client field and drop a leftover wire key so passthrough serialization cannot send it. */
export function sandboxWithEnvironmentName(
  sandbox: SandboxConfig | undefined,
  environmentName: string | undefined,
): SandboxConfig {
  const next: SandboxConfig = { ...sandbox, environmentName };
  Reflect.deleteProperty(next, 'environment_name');
  return next;
}

/**
 * Client field wins. Copy a leftover wire `environment_name` only when the client
 * field is empty, then drop the wire key.
 */
function normalizeSandboxEnvironmentName(spec: AgentSpec): AgentSpec {
  const sandbox = spec.config?.sandbox;
  if (sandbox === undefined || !Reflect.has(sandbox, 'environment_name')) return spec;

  const camelName = readTrimmedString(sandbox, 'environmentName');
  const snakeName = readTrimmedString(sandbox, 'environment_name');
  const nextSandbox: SandboxConfig = { ...sandbox };
  Reflect.deleteProperty(nextSandbox, 'environment_name');
  if (camelName.length === 0 && snakeName.length > 0) {
    nextSandbox.environmentName = snakeName;
  }
  return {
    ...spec,
    config: {
      ...spec.config,
      sandbox: nextSandbox,
    },
  };
}

function readWebSearchEnabled(spec: AgentSpec): boolean | undefined {
  if (spec.config?.webSearch === undefined) return undefined;
  const enabled = spec.config.webSearch.enabled;
  return typeof enabled === 'boolean' ? enabled : undefined;
}

/**
 * New Chat: model (+ reasoning params), skills, MCP, and the web-search / TrueForge toggles.
 * Other runtime config (sandbox, ask-user, …) is not persisted for chat.
 */
export function selectChatDraftSpecPreferences(spec: AgentSpec): AgentSpec {
  const webSearchEnabled = readWebSearchEnabled(spec);
  const trueforgeEnabled = readDraftTrueforgeEnabled(spec.config);
  const config = {
    ...(webSearchEnabled !== undefined ? { webSearch: { enabled: webSearchEnabled } } : {}),
    ...(trueforgeEnabled !== undefined ? { trueforge: { enabled: trueforgeEnabled } } : {}),
  };
  return {
    model: spec.model,
    ...(spec.skills !== undefined ? { skills: spec.skills } : {}),
    ...(spec.mcpServers !== undefined ? { mcpServers: spec.mcpServers } : {}),
    ...(Object.keys(config).length > 0 ? { config } : {}),
  };
}

/** New Agent: full composer seed including runtime config (sandbox, ask-user, memory, …). */
export function selectAgentDraftSpecPreferences(spec: AgentSpec): AgentSpec {
  const normalized = normalizeSandboxEnvironmentName(spec);
  return {
    ...selectChatDraftSpecPreferences(normalized),
    ...(normalized.config !== undefined ? { config: normalized.config } : {}),
  };
}

/**
 * Fresh New Agent seed after save/reset: keep model + runtime toggles, drop
 * instructions / initial messages / MCP / skills from the previous build.
 */
export function freshAgentBuilderSeed(spec: AgentSpec): AgentSpec {
  return {
    model: spec.model,
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
 * When web-search becomes available, a live `enabled: false` may be leftover force-off
 * or a schema default from an inline session created before capabilities loaded.
 * Default-fill on only when that false is not an explicit user/saved choice.
 *
 * New Chat (`kind: 'chat'`) also recovers when capability first becomes known
 * (`null`/`undefined` → true), so a premature createSession does not stick off.
 * Agent drafts keep an explicit off across first capability load.
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
  if (webSearchEnabled !== true) return spec;
  if (readWebSearchEnabled(spec) !== false) return spec;

  const capabilityReturned = previousWebSearchEnabled === false;
  const capabilityBecameKnown = previousWebSearchEnabled == null && kind === 'chat';
  if (!capabilityReturned && !capabilityBecameKnown) return spec;

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
 * Remember a user web-search choice. Capability-forced off, or any value seen before capabilities
 * settle (a schema default, not a choice), is omitted unless a choice was already stored; a stored off
 * is not rewritten to on when search returns.
 */
export function webSearchPreferenceToStore({
  spec,
  webSearchEnabled,
  previousWebSearchEnabled,
  capabilitiesPending = false,
  kind,
}: {
  spec: AgentSpec;
  webSearchEnabled: boolean | null | undefined;
  previousWebSearchEnabled: boolean | null | undefined;
  capabilitiesPending?: boolean;
  kind: DraftPreferenceKind;
}): AgentSpec {
  const persistedEnabled = persistedWebSearchEnabled(kind);
  if (webSearchEnabled === false || capabilitiesPending) {
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

function readMemoryEnabled(spec: AgentSpec): boolean | undefined {
  const enabled = spec.config?.memory?.enabled;
  return typeof enabled === 'boolean' ? enabled : undefined;
}

function withMemoryEnabled(spec: AgentSpec, enabled: boolean): AgentSpec {
  if (readMemoryEnabled(spec) === enabled) return spec;
  return { ...spec, config: { ...spec.config, memory: { enabled } } };
}

/** Drop memory so a value seen while memory is unavailable is not stored as a user preference. */
export function withoutMemoryPreference(spec: AgentSpec): AgentSpec {
  if (spec.config?.memory === undefined) return spec;
  const { memory: _ignored, ...restConfig } = spec.config;
  if (Object.keys(restConfig).length === 0) {
    const { config: _config, ...rest } = spec;
    return rest;
  }
  return { ...spec, config: restConfig };
}

/** Memory is an agent setting, so only New Agent preferences store it. */
export function persistedMemoryEnabled(): boolean | undefined {
  const stored = readDraftSpecPreferences('agent');
  return stored == null ? undefined : readMemoryEnabled(stored);
}

/**
 * When memory becomes available again, a draft `enabled: false` may be the schema default of an
 * agent saved while memory was unavailable. Turn it back on unless the stored choice is off.
 */
export function recoverMemoryAfterCapabilityAvailable({
  spec,
  previousMemoryEnabled,
  memoryEnabled,
  explicitOff = false,
}: {
  spec: AgentSpec;
  previousMemoryEnabled: boolean | null | undefined;
  memoryEnabled: boolean | null | undefined;
  /** A stored off is a user choice, not a value left over from the outage. */
  explicitOff?: boolean;
}): AgentSpec {
  if (explicitOff || memoryEnabled !== true || previousMemoryEnabled !== false) return spec;
  if (readMemoryEnabled(spec) !== false) return spec;
  return withMemoryEnabled(spec, true);
}

/**
 * Remember a user memory choice for the next New Agent. While memory is unavailable or capabilities
 * are pending, the draft value is not a choice, so the stored one (if any) is kept instead.
 */
export function memoryPreferenceToStore({
  spec,
  memoryEnabled,
  previousMemoryEnabled,
  capabilitiesPending = false,
}: {
  spec: AgentSpec;
  memoryEnabled: boolean | null | undefined;
  previousMemoryEnabled: boolean | null | undefined;
  capabilitiesPending?: boolean;
}): AgentSpec {
  const persistedEnabled = persistedMemoryEnabled();
  if (memoryEnabled !== true || capabilitiesPending) {
    const stripped = withoutMemoryPreference(spec);
    return persistedEnabled === undefined ? stripped : withMemoryEnabled(stripped, persistedEnabled);
  }
  return recoverMemoryAfterCapabilityAvailable({
    spec,
    previousMemoryEnabled,
    memoryEnabled,
    explicitOff: persistedEnabled === false,
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
  return stored == null ? null : selectDraftSpecPreferences(normalizeSandboxEnvironmentName(stored), kind);
}

export function writeDraftSpecPreferences(kind: DraftPreferenceKind, spec: AgentSpec): void {
  writeStoredSpec(storageKeyForKind(kind), selectDraftSpecPreferences(spec, kind));
}
