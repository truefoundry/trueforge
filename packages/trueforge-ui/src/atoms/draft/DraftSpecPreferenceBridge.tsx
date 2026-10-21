'use client';

import { useTrueForgeAgentSpec, useTrueForgeUpdateAgentSpec } from '@truefoundry/trueforge-assistant-ui-runtime';
import { useEffect, useRef } from 'react';

import {
  type DraftPreferenceKind,
  persistedWebSearchEnabled,
  recoverWebSearchAfterCapabilityAvailable,
  withCapabilitiesSandbox,
  withCapabilitiesWebSearch,
} from '../../server/draftSpecPreferences.js';
import { useServerCapabilities } from '../../server/ServerContext.js';
import { useShellMode } from '../../server/ShellModeContext.js';
import type { AgentSkill, AgentSpec, ConnectorState, ModelSelection } from '../../server/types.js';
import { mountName } from '../lib/mountName.js';
import { useDraftCatalog } from './DraftCatalogProvider.js';
import { modelPatchWithReasoningEffort } from './reasoningEffort.js';
import { skillFamilyId } from './SkillVersionSelector.js';

function readDraftSandboxEnabled(spec: AgentSpec): boolean | undefined {
  if (spec.config === undefined) return undefined;
  // `sandbox` is draft runtime config and may be absent from AgentRuntimeConfig typings.
  const sandbox = Reflect.get(spec.config, 'sandbox');
  if (typeof sandbox !== 'object' || sandbox === null) return undefined;
  const enabled = Reflect.get(sandbox, 'enabled');
  return typeof enabled === 'boolean' ? enabled : undefined;
}

function filterMounts<T extends object>(
  mounts: T[] | undefined,
  availableNames: Set<string>,
  { matchFamily = false }: { matchFamily?: boolean } = {},
): T[] | undefined {
  if (mounts === undefined) return undefined;
  const filtered = mounts.filter(mount => {
    const name = mountName(mount);
    if (name === null) return false;
    if (availableNames.has(name)) return true;
    return matchFamily && availableNames.has(skillFamilyId(name));
  });
  return filtered.length === mounts.length ? mounts : filtered;
}

function skillAvailableKeys(skills: AgentSkill[]): Set<string> {
  const keys = new Set<string>();
  for (const skill of skills) {
    keys.add(skill.name);
    keys.add(skill.id);
    keys.add(skillFamilyId(skill.id));
  }
  return keys;
}

/** Chips render `name`. A post-turn mount stores the FQN there; swap in the catalog label. */
function labelSkillMounts(mounts: object[] | undefined, skills: readonly AgentSkill[]): object[] | undefined {
  if (mounts === undefined) return undefined;
  let changed = false;
  const next = mounts.map(mount => {
    const name = mountName(mount);
    const catalog = skills.find(skill => skill.id === name);
    if (catalog === undefined || name === catalog.name) return mount;
    changed = true;
    return { ...mount, id: catalog.id, name: catalog.name };
  });
  return changed ? next : mounts;
}

export function reconcileDraftSpecPreferences({
  agentSpec,
  models,
  skills,
  connectors,
  skillsEnabled,
}: {
  agentSpec: AgentSpec;
  models: ModelSelection[];
  skills: AgentSkill[];
  connectors: ConnectorState[];
  skillsEnabled: boolean | undefined;
}): Partial<AgentSpec> {
  const update: Partial<AgentSpec> = {};
  const selectedModel = agentSpec.model.name.trim();
  if (!models.some(model => model.name === selectedModel)) {
    const fallback = models[0];
    if (fallback !== undefined) {
      update.model = modelPatchWithReasoningEffort(
        fallback.name,
        agentSpec.model.params,
        fallback.properties.reasoningEfforts,
      );
    }
  }

  const nextMcpServers = filterMounts(agentSpec.mcpServers, new Set(connectors.map(connector => connector.name)));
  if (nextMcpServers !== agentSpec.mcpServers) {
    update.mcpServers = nextMcpServers;
  }

  if (skillsEnabled === false) {
    // Only clear when there is something to clear — a fresh `[]` each call would
    // fail reference equality and loop `updateAgentSpec` forever.
    if (agentSpec.skills !== undefined && agentSpec.skills.length > 0) {
      update.skills = [];
    }
  } else {
    const nextSkills = labelSkillMounts(
      filterMounts(agentSpec.skills, skillAvailableKeys(skills), { matchFamily: true }),
      skills,
    );
    if (nextSkills !== agentSpec.skills) {
      update.skills = nextSkills;
    }
  }

  return update;
}

export function reconcileDraftSandbox({
  agentSpec,
  sandboxEnabled,
  kind = 'agent',
}: {
  agentSpec: AgentSpec;
  sandboxEnabled: boolean | null | undefined;
  kind?: DraftPreferenceKind;
}): Partial<AgentSpec> {
  if (kind === 'chat') {
    if (sandboxEnabled == null) return {};
    const current = readDraftSandboxEnabled(agentSpec);
    if (sandboxEnabled === true && current !== true) {
      return {
        config: {
          ...agentSpec.config,
          sandbox: { ...agentSpec.config?.sandbox, enabled: true },
        },
      };
    }
    if (sandboxEnabled === false && current === true) {
      return {
        config: {
          ...agentSpec.config,
          sandbox: { ...agentSpec.config?.sandbox, enabled: false },
        },
      };
    }
    return {};
  }

  const nextSpec = withCapabilitiesSandbox(agentSpec, sandboxEnabled);
  return nextSpec === agentSpec ? {} : { config: nextSpec.config };
}

export function reconcileDraftWebSearch({
  agentSpec,
  webSearchEnabled,
  previousWebSearchEnabled,
  explicitOff = false,
  kind = 'agent',
}: {
  agentSpec: AgentSpec;
  webSearchEnabled: boolean | null | undefined;
  previousWebSearchEnabled?: boolean | null | undefined;
  explicitOff?: boolean;
  kind?: DraftPreferenceKind;
}): Partial<AgentSpec> {
  const recovered = recoverWebSearchAfterCapabilityAvailable({
    spec: agentSpec,
    previousWebSearchEnabled,
    webSearchEnabled,
    explicitOff,
    kind,
  });
  const nextSpec = withCapabilitiesWebSearch({ spec: recovered, webSearchEnabled, kind });
  return nextSpec === agentSpec ? {} : { config: nextSpec.config };
}

/**
 * Mirrors plain-draft composer choices into the shell seed and removes catalog
 * entries that disappeared since those choices were stored.
 * New Chat and New Agent keep separate seeds; chat persists web-search only
 * among runtime config fields.
 */
export function DraftSpecPreferenceBridge() {
  const { mode, pendingSessionId, rememberDraftSpec } = useShellMode();
  const { agentSpec, isSpecLoading } = useTrueForgeAgentSpec();
  const updateAgentSpec = useTrueForgeUpdateAgentSpec();
  const capabilities = useServerCapabilities();
  const sandboxEnabled = capabilities?.sandbox.enabled;
  const webSearchEnabled = capabilities?.webSearch?.enabled;
  const prevWebSearchEnabledRef = useRef(webSearchEnabled);
  const { models, skills, connectors, loaded, error, ensureLoaded } = useDraftCatalog();
  const isMutableDraft = mode.status === 'active' && mode.isMutable && pendingSessionId == null;
  const isPlainDraft = isMutableDraft && mode.agentId == null;
  // While a history session's stored spec is loading, agentSpec is still the New Chat
  // seed — do not reconcile/PATCH that seed onto the resumed session.
  const canReconcileLiveSpec = !isSpecLoading;
  const preferenceKind = mode.status === 'active' && mode.isMutable && mode.isCreateAgent ? 'agent' : 'chat';
  useEffect(() => {
    if (isPlainDraft) ensureLoaded();
  }, [ensureLoaded, isPlainDraft]);

  useEffect(() => {
    if (isPlainDraft && canReconcileLiveSpec && agentSpec != null) {
      rememberDraftSpec(agentSpec, preferenceKind);
    }
  }, [agentSpec, canReconcileLiveSpec, isPlainDraft, preferenceKind, rememberDraftSpec]);

  useEffect(() => {
    // New Chat mirrors capabilities onto the live draft; New Agent only disables when unavailable.
    if (!isPlainDraft || !canReconcileLiveSpec || agentSpec == null || updateAgentSpec == null) return;
    const update = reconcileDraftSandbox({ agentSpec, sandboxEnabled, kind: preferenceKind });
    if (Object.keys(update).length > 0) {
      updateAgentSpec(update);
    }
  }, [agentSpec, canReconcileLiveSpec, isPlainDraft, preferenceKind, sandboxEnabled, updateAgentSpec]);

  useEffect(() => {
    // Apply to New Chat / New Agent / edit-existing mutable drafts.
    // Available → default on when absent; unavailable → force off. Explicit toggles are preserved.
    // Force-off recovery is only for plain drafts, and only when no choice was stored.
    const previousWebSearchEnabled = prevWebSearchEnabledRef.current;
    prevWebSearchEnabledRef.current = webSearchEnabled;
    if (!isMutableDraft || !canReconcileLiveSpec || agentSpec == null || updateAgentSpec == null) return;
    const update = reconcileDraftWebSearch({
      agentSpec,
      webSearchEnabled,
      previousWebSearchEnabled: isPlainDraft ? previousWebSearchEnabled : undefined,
      explicitOff: isPlainDraft && persistedWebSearchEnabled(preferenceKind) === false,
      kind: preferenceKind,
    });
    if (Object.keys(update).length > 0) {
      updateAgentSpec(update);
    }
  }, [
    agentSpec,
    canReconcileLiveSpec,
    isMutableDraft,
    isPlainDraft,
    preferenceKind,
    webSearchEnabled,
    updateAgentSpec,
  ]);

  useEffect(() => {
    if (
      !isPlainDraft ||
      !canReconcileLiveSpec ||
      agentSpec == null ||
      updateAgentSpec == null ||
      !loaded ||
      error != null
    ) {
      return;
    }

    const update = reconcileDraftSpecPreferences({
      agentSpec,
      models,
      skills,
      connectors,
      skillsEnabled: capabilities?.skill.enabled,
    });
    if (Object.keys(update).length > 0) {
      updateAgentSpec(update);
    }
  }, [
    agentSpec,
    canReconcileLiveSpec,
    capabilities?.skill.enabled,
    connectors,
    error,
    isPlainDraft,
    loaded,
    models,
    skills,
    updateAgentSpec,
  ]);

  return null;
}
