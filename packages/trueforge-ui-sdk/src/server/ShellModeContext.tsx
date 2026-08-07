'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import type { AgentLibraryEntry, AgentSpec } from './types.js';

/** Host-facing shell configuration for agent / library / composer chrome. */
export type AgentConfig =
  | { mode: 'SingleAgent'; name: string }
  | { mode: 'AgentLibrary' }
  | { mode: 'AgentComposer'; defaultAgentSpec?: AgentSpec }
  | { mode: 'AgentLibraryWithComposer'; defaultAgentSpec?: AgentSpec };

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  mode: 'AgentLibraryWithComposer',
};

/**
 * Active chat binding. Mutability (`isMutable`) decides composer / Save / updateSession —
 * not a parallel draft|named shell type.
 */
export type ShellMode =
  | { status: 'idle' }
  | {
      status: 'active';
      isMutable: boolean;
      /** Identity for immutable bind + history filter. */
      agentId?: string;
      /** Display / welcome label (often same as agentId). */
      agentName?: string;
      /** Seed for mutable (draft) runtime. */
      agentSpec?: AgentSpec;
      locked: boolean;
    };

/** Library / New Chat create intent. */
export type SelectLibraryAgentRequest = {
  isMutable: boolean;
  agentId?: string;
  agentName?: string;
  agentSpec?: AgentSpec;
};

type ShellModeContextValue = {
  mode: ShellMode;
  /** Host agentConfig mode (capabilities source). */
  agentConfigMode: AgentConfig['mode'];
  /** Agents Library chrome. */
  isLibraryEnabled: boolean;
  /** Mutable composer / Save Agent chrome (host capability). */
  isComposerEnabled: boolean;
  /** Sidebar / list New Chat control. */
  isNewChatEnabled: boolean;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /**
   * Bind from the Agents Library (Try = immutable, Edit = mutable + agentSpec).
   * Prefer this over `selectAgent` / `openDraft` when both fields are available.
   */
  selectLibraryAgent: (req: SelectLibraryAgentRequest) => void;
  /**
   * Attach identity + agentSpec to the *current* mutable chat without remounting.
   * Used after `saveAgent` so the same draft session continues as an editable agent.
   */
  bindMutableAgent: (req: { agentId: string; agentName: string; agentSpec: AgentSpec }) => void;
  /** @deprecated Prefer `selectLibraryAgent({ isMutable: false, agentName })`. */
  selectAgent: (agentName: string) => void;
  /** @deprecated Prefer `selectLibraryAgent({ isMutable: true, agentSpec })`. */
  openDraft: () => void;
  /**
   * Open a history session, remounting when mutability/identity changes.
   * Prefer explicit `isMutable` from the session row; when omitted, agentName
   * present → immutable and agentName absent → mutable. Immutable rows may omit
   * `agentName` when the registry agent was deleted.
   */
  openHistorySession: (req: { sessionId: string; agentName?: string; isMutable?: boolean }) => void;
  /** Reset current chat; no-op when idle. */
  clearChat: () => void;
  /** Remount key for the chat runtime when binding changes. */
  runtimeKey: string;
  /**
   * History list filter forwarded as `listSessions({ agentId })`.
   * `null` = All chats. Only meaningful when `isLibraryEnabled`.
   */
  historyAgentFilter: string | null;
  setHistoryAgentFilter: (agentId: string | null) => void;
  /** Effective `listSessionsAgentId` for the runtime (SingleAgent locks to name). */
  listSessionsAgentId: string | undefined;
  /** Session to open after a binding remount (history click across mutability). */
  pendingSessionId: string | undefined;
  /**
   * Bumped when the Agents Library catalog may have changed (e.g. after saveAgent).
   * Library chrome should re-fetch when this changes.
   */
  agentsListEpoch: number;
  invalidateAgentsList: () => void;
};

const ShellModeContext = createContext<ShellModeContextValue | null>(null);

const FALLBACK_MUTABLE_SPEC: AgentSpec = {
  model: { name: 'openai-main/gpt-4.1' },
};

function mutableSeedFromConfig(config: AgentConfig): AgentSpec {
  if (config.mode === 'AgentComposer' || config.mode === 'AgentLibraryWithComposer') {
    return config.defaultAgentSpec ?? FALLBACK_MUTABLE_SPEC;
  }
  return FALLBACK_MUTABLE_SPEC;
}

function initialMode(config: AgentConfig, mutableSeed: AgentSpec): ShellMode {
  switch (config.mode) {
    case 'SingleAgent':
      return {
        status: 'active',
        isMutable: false,
        agentId: config.name,
        agentName: config.name,
        locked: true,
      };
    case 'AgentLibrary':
      return { status: 'idle' };
    case 'AgentComposer':
    case 'AgentLibraryWithComposer':
      return {
        status: 'active',
        isMutable: true,
        agentSpec: mutableSeed,
        locked: false,
      };
  }
}

function libraryAgentId(agent: Pick<AgentLibraryEntry, 'agentId' | 'name'>): string {
  return agent.agentId ?? agent.name;
}

export function ShellModeProvider({
  agentConfig = DEFAULT_AGENT_CONFIG,
  children,
}: {
  agentConfig?: AgentConfig;
  children: ReactNode;
}) {
  const mutableSeedRef = useRef(mutableSeedFromConfig(agentConfig));
  if (
    (agentConfig.mode === 'AgentComposer' || agentConfig.mode === 'AgentLibraryWithComposer') &&
    agentConfig.defaultAgentSpec != null
  ) {
    mutableSeedRef.current = agentConfig.defaultAgentSpec;
  }
  const mutableSeed = mutableSeedRef.current;

  const isLibraryEnabled = agentConfig.mode === 'AgentLibrary' || agentConfig.mode === 'AgentLibraryWithComposer';
  const isComposerEnabled = agentConfig.mode === 'AgentComposer' || agentConfig.mode === 'AgentLibraryWithComposer';
  const isNewChatEnabled = agentConfig.mode !== 'AgentLibrary';
  const locked = agentConfig.mode === 'SingleAgent';

  const [mode, setMode] = useState<ShellMode>(() => initialMode(agentConfig, mutableSeed));
  const [mutableEpoch, setMutableEpoch] = useState(0);
  const [clearEpoch, setClearEpoch] = useState(0);
  const [agentsListEpoch, setAgentsListEpoch] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyAgentFilter, setHistoryAgentFilter] = useState<string | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | undefined>(undefined);

  const invalidateAgentsList = useCallback(() => {
    setAgentsListEpoch(n => n + 1);
  }, []);

  const lockedAgentName = agentConfig.mode === 'SingleAgent' ? agentConfig.name : '';
  const effectiveMode: ShellMode = useMemo(() => {
    if (!locked) return mode;
    return {
      status: 'active',
      isMutable: false,
      agentId: lockedAgentName,
      agentName: lockedAgentName,
      locked: true,
    };
  }, [locked, lockedAgentName, mode]);

  const listSessionsAgentId = useMemo(() => {
    if (locked) return lockedAgentName;
    if (!isLibraryEnabled) return undefined;
    return historyAgentFilter ?? undefined;
  }, [locked, lockedAgentName, isLibraryEnabled, historyAgentFilter]);

  const bumpEpoch = useCallback((isMutable: boolean) => {
    if (isMutable) setMutableEpoch(n => n + 1);
    else setClearEpoch(n => n + 1);
  }, []);

  const selectLibraryAgent = useCallback(
    (req: SelectLibraryAgentRequest) => {
      if (req.isMutable) {
        if (!isComposerEnabled) return;
        setSettingsOpen(false);
        setPendingSessionId(undefined);
        setMode({
          status: 'active',
          isMutable: true,
          agentId: req.agentId,
          agentName: req.agentName,
          agentSpec: req.agentSpec ?? mutableSeedRef.current,
          locked: false,
        });
        bumpEpoch(true);
        return;
      }
      if (!isLibraryEnabled) return;
      const agentName = req.agentName ?? req.agentId;
      if (agentName == null) return;
      setSettingsOpen(false);
      setPendingSessionId(undefined);
      setMode({
        status: 'active',
        isMutable: false,
        agentId: req.agentId ?? agentName,
        agentName,
        locked: false,
      });
      bumpEpoch(false);
    },
    [isComposerEnabled, isLibraryEnabled, bumpEpoch],
  );

  const bindMutableAgent = useCallback(
    (req: { agentId: string; agentName: string; agentSpec: AgentSpec }) => {
      if (!isComposerEnabled) return;
      setMode(prev => {
        if (prev.status !== 'active' || !prev.isMutable) return prev;
        return {
          status: 'active',
          isMutable: true,
          agentId: req.agentId,
          agentName: req.agentName,
          agentSpec: req.agentSpec,
          locked: false,
        };
      });
    },
    [isComposerEnabled],
  );

  const selectAgent = useCallback(
    (name: string) => {
      selectLibraryAgent({ isMutable: false, agentId: name, agentName: name });
    },
    [selectLibraryAgent],
  );

  const openDraft = useCallback(() => {
    selectLibraryAgent({ isMutable: true, agentSpec: mutableSeedRef.current });
  }, [selectLibraryAgent]);

  const openHistorySession = useCallback(
    ({
      sessionId,
      agentName,
      isMutable: isMutableOpt,
    }: {
      sessionId: string;
      agentName?: string;
      isMutable?: boolean;
    }) => {
      setSettingsOpen(false);
      setPendingSessionId(sessionId);
      const isMutable = isMutableOpt ?? agentName == null;
      if (isMutable) {
        if (!isComposerEnabled) return;
        setMode({
          status: 'active',
          isMutable: true,
          agentSpec: mutableSeedRef.current,
          locked: false,
        });
        bumpEpoch(true);
        return;
      }
      // Immutable: allow orphaned refs (deleted agent → no agentName).
      if (locked) {
        if (agentName == null || lockedAgentName !== agentName) return;
      } else if (!isLibraryEnabled) {
        return;
      }
      setMode({
        status: 'active',
        isMutable: false,
        locked: false,
        ...(agentName != null ? { agentId: agentName, agentName } : {}),
      });
      bumpEpoch(false);
    },
    [isLibraryEnabled, isComposerEnabled, locked, lockedAgentName, bumpEpoch],
  );

  const clearChat = useCallback(() => {
    if (effectiveMode.status === 'idle') return;
    setPendingSessionId(undefined);
    if (effectiveMode.isMutable) {
      // Preserve Edit binding (name + seeded spec); blank drafts fall back to host seed.
      setMode({
        status: 'active',
        isMutable: true,
        agentId: effectiveMode.agentId,
        agentName: effectiveMode.agentName,
        agentSpec: effectiveMode.agentSpec ?? mutableSeedRef.current,
        locked: false,
      });
      bumpEpoch(true);
      return;
    }
    bumpEpoch(false);
  }, [effectiveMode, bumpEpoch]);

  // Mutable remounts are driven only by mutableEpoch (library Edit / New Chat / Clear).
  // Agent id and model must not be in the key — saveAgent binds those onto the same draft.
  const runtimeKey = useMemo(() => {
    if (effectiveMode.status === 'idle') return 'idle';
    if (effectiveMode.isMutable) {
      return `mut:${pendingSessionId ?? ''}:${mutableEpoch}`;
    }
    const id = effectiveMode.agentId ?? effectiveMode.agentName ?? '';
    return `immut:${id}:${pendingSessionId ?? ''}:${clearEpoch}`;
  }, [effectiveMode, mutableEpoch, clearEpoch, pendingSessionId]);

  const value = useMemo<ShellModeContextValue>(
    () => ({
      mode: effectiveMode,
      agentConfigMode: agentConfig.mode,
      isLibraryEnabled,
      isComposerEnabled,
      isNewChatEnabled,
      settingsOpen,
      setSettingsOpen,
      selectLibraryAgent,
      bindMutableAgent,
      selectAgent,
      openDraft,
      openHistorySession,
      clearChat,
      runtimeKey,
      historyAgentFilter,
      setHistoryAgentFilter,
      listSessionsAgentId,
      pendingSessionId,
      agentsListEpoch,
      invalidateAgentsList,
    }),
    [
      effectiveMode,
      agentConfig.mode,
      isLibraryEnabled,
      isComposerEnabled,
      isNewChatEnabled,
      settingsOpen,
      selectLibraryAgent,
      bindMutableAgent,
      selectAgent,
      openDraft,
      openHistorySession,
      clearChat,
      runtimeKey,
      historyAgentFilter,
      listSessionsAgentId,
      pendingSessionId,
      agentsListEpoch,
      invalidateAgentsList,
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

/** True when the shell is bound to a mutable (editable) agentSpec. */
export function shellIsMutable(mode: ShellMode): boolean {
  return mode.status === 'active' && mode.isMutable;
}

export { libraryAgentId };
