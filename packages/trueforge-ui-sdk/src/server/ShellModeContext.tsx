'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import type { AgentSpec } from './types.js';

/** Host-facing shell configuration for agent / library / composer chrome. */
export type AgentConfig =
  | { mode: 'SingleAgent'; name: string }
  | { mode: 'AgentLibrary' }
  | { mode: 'AgentComposer'; defaultAgentSpec?: AgentSpec }
  | { mode: 'AgentLibraryWithComposer'; defaultAgentSpec?: AgentSpec };

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  mode: 'AgentLibraryWithComposer',
};

export type ShellMode =
  | { type: 'idle' }
  | { type: 'named'; agentName: string; locked: boolean }
  | { type: 'draft'; defaultAgentSpec: AgentSpec };

type ShellModeContextValue = {
  mode: ShellMode;
  /** Host agentConfig mode (capabilities source). */
  agentConfigMode: AgentConfig['mode'];
  /** Agents Library chrome. */
  isLibraryEnabled: boolean;
  /** Draft composer / Save Agent chrome. */
  isComposerEnabled: boolean;
  /** Sidebar / list New Chat control. */
  isNewChatEnabled: boolean;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  selectAgent: (agentName: string) => void;
  openDraft: () => void;
  /** Reset current named or draft chat; no-op when idle. */
  clearChat: () => void;
  /** Remount key for the chat runtime when mode/agent changes. */
  runtimeKey: string;
};

const ShellModeContext = createContext<ShellModeContextValue | null>(null);

const FALLBACK_DRAFT_SPEC: AgentSpec = {
  model: { name: 'openai-main/gpt-4.1' },
};

function draftSeedFromConfig(config: AgentConfig): AgentSpec {
  if (config.mode === 'AgentComposer' || config.mode === 'AgentLibraryWithComposer') {
    return config.defaultAgentSpec ?? FALLBACK_DRAFT_SPEC;
  }
  return FALLBACK_DRAFT_SPEC;
}

function initialMode(config: AgentConfig, draftSeed: AgentSpec): ShellMode {
  switch (config.mode) {
    case 'SingleAgent':
      return { type: 'named', agentName: config.name, locked: true };
    case 'AgentLibrary':
      return { type: 'idle' };
    case 'AgentComposer':
    case 'AgentLibraryWithComposer':
      return { type: 'draft', defaultAgentSpec: draftSeed };
  }
}

export function ShellModeProvider({
  agentConfig = DEFAULT_AGENT_CONFIG,
  children,
}: {
  agentConfig?: AgentConfig;
  children: ReactNode;
}) {
  const draftSeedRef = useRef(draftSeedFromConfig(agentConfig));
  if (
    (agentConfig.mode === 'AgentComposer' || agentConfig.mode === 'AgentLibraryWithComposer') &&
    agentConfig.defaultAgentSpec != null
  ) {
    draftSeedRef.current = agentConfig.defaultAgentSpec;
  }
  const draftSeed = draftSeedRef.current;

  const isLibraryEnabled = agentConfig.mode === 'AgentLibrary' || agentConfig.mode === 'AgentLibraryWithComposer';
  const isComposerEnabled = agentConfig.mode === 'AgentComposer' || agentConfig.mode === 'AgentLibraryWithComposer';
  const isNewChatEnabled = agentConfig.mode !== 'AgentLibrary';
  const locked = agentConfig.mode === 'SingleAgent';

  const [mode, setMode] = useState<ShellMode>(() => initialMode(agentConfig, draftSeed));
  const [draftEpoch, setDraftEpoch] = useState(0);
  const [clearEpoch, setClearEpoch] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const lockedAgentName = agentConfig.mode === 'SingleAgent' ? agentConfig.name : '';
  const effectiveMode: ShellMode = useMemo(
    () => (locked ? { type: 'named', agentName: lockedAgentName, locked: true } : mode),
    [locked, lockedAgentName, mode],
  );

  const selectAgent = useCallback(
    (name: string) => {
      if (!isLibraryEnabled) return;
      // Leaving Settings so the main pane shows the selected agent chat.
      setSettingsOpen(false);
      setMode({ type: 'named', agentName: name, locked: false });
      // Re-picking the current agent must still remount the runtime.
      setClearEpoch(n => n + 1);
    },
    [isLibraryEnabled],
  );

  const openDraft = useCallback(() => {
    if (!isComposerEnabled) return;
    // New Chat while Settings is open must reveal the draft composer.
    setSettingsOpen(false);
    setMode({ type: 'draft', defaultAgentSpec: draftSeedRef.current });
    setDraftEpoch(n => n + 1);
  }, [isComposerEnabled]);

  const clearChat = useCallback(() => {
    if (effectiveMode.type === 'idle') return;
    if (effectiveMode.type === 'draft') {
      setMode({ type: 'draft', defaultAgentSpec: draftSeedRef.current });
      setDraftEpoch(n => n + 1);
      return;
    }
    setClearEpoch(n => n + 1);
  }, [effectiveMode]);

  const runtimeKey =
    effectiveMode.type === 'idle'
      ? 'idle'
      : effectiveMode.type === 'named'
        ? `named:${effectiveMode.agentName}:${clearEpoch}`
        : `draft:${effectiveMode.defaultAgentSpec.model.name}:${draftEpoch}`;

  const value = useMemo<ShellModeContextValue>(
    () => ({
      mode: effectiveMode,
      agentConfigMode: agentConfig.mode,
      isLibraryEnabled,
      isComposerEnabled,
      isNewChatEnabled,
      settingsOpen,
      setSettingsOpen,
      selectAgent,
      openDraft,
      clearChat,
      runtimeKey,
    }),
    [
      effectiveMode,
      agentConfig.mode,
      isLibraryEnabled,
      isComposerEnabled,
      isNewChatEnabled,
      settingsOpen,
      selectAgent,
      openDraft,
      clearChat,
      runtimeKey,
    ],
  );

  return <ShellModeContext.Provider value={value}>{children}</ShellModeContext.Provider>;
}

export function useShellMode(): ShellModeContextValue {
  const ctx = useContext(ShellModeContext);
  if (ctx == null) {
    throw new Error('useShellMode must be used within a ShellModeProvider.');
  }
  return ctx;
}

export function useOptionalShellMode(): ShellModeContextValue | null {
  return useContext(ShellModeContext);
}
