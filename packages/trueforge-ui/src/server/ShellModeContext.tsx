'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { replaceSessionShareSearch } from '../utils/sessionShareUrl.js';
import {
  readDraftSpecPreferences,
  selectDraftSpecPreferences,
  withCapabilitiesSandbox,
  writeDraftSpecPreferences,
} from './draftSpecPreferences.js';
import {
  useOptionalRefreshServerCapabilities,
  useOptionalScheduleServer,
  useServerCapabilities,
} from './ServerContext.js';
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

export type SettingsSection = 'models' | 'connectors' | 'skills' | 'sandbox';

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
  settingsSection: SettingsSection;
  setSettingsOpen: (open: boolean, section?: SettingsSection) => void;
  /** Agents Library main-pane overlay (sidebar layout). */
  libraryOpen: boolean;
  libraryAgentId: string | null;
  setLibraryAgentId: (id: string | null) => void;
  setLibraryOpen: (open: boolean) => void;
  /** All-user sessions browser (includes drafts). */
  sessionsOpen: boolean;
  setSessionsOpen: (open: boolean) => void;
  openLibraryAgent: (agentId: string) => void;
  closeLibraryAgent: () => void;
  schedulesOpen: boolean;
  setSchedulesOpen: (open: boolean) => void;
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
  /** Remember plain-draft composer choices as the seed for future new chats. */
  rememberDraftSpec: (agentSpec: AgentSpec) => void;
  /**
   * Open a history session, remounting when mutability/identity changes.
   * Prefer explicit `isMutable` from the session row; when omitted, agentName
   * present → immutable and agentName absent → mutable. Immutable rows may omit
   * `agentName` when the registry agent was deleted.
   */
  openHistorySession: (req: { sessionId: string; agentName?: string; isMutable?: boolean }) => void;
  /** Reset current chat; no-op when idle. */
  clearChat: () => void;
  /** Return pure Agents Library to its idle landing; no-op in other modes. */
  openLibraryHome: () => void;
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
  initialSettingsOpen = false,
  children,
}: {
  agentConfig?: AgentConfig;
  /** Open settings on first paint (e.g. host boot with no models). Does not re-open later. */
  initialSettingsOpen?: boolean;
  children: ReactNode;
}) {
  const capabilities = useServerCapabilities();
  const refreshCapabilities = useOptionalRefreshServerCapabilities();
  const scheduleServer = useOptionalScheduleServer();
  const rememberedSpecRef = useRef<AgentSpec | null>(readDraftSpecPreferences());
  const mutableSeedRef = useRef(rememberedSpecRef.current ?? mutableSeedFromConfig(agentConfig));
  if (
    rememberedSpecRef.current == null &&
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
  const [settingsOpenState, setSettingsOpenState] = useState(initialSettingsOpen);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('models');
  const [libraryOpenState, setLibraryOpenState] = useState(false);
  const [sessionsOpenState, setSessionsOpenState] = useState(false);
  const [libraryAgentId, setLibraryAgentId] = useState<string | null>(null);
  const [schedulesOpenState, setSchedulesOpenState] = useState(false);
  const [historyAgentFilter, setHistoryAgentFilter] = useState<string | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | undefined>(undefined);
  const settingsEnabled = capabilities?.settings?.enabled !== false;
  const settingsOpen = settingsEnabled && settingsOpenState;
  const schedulesEnabled = scheduleServer != null;
  const schedulesOpen = schedulesEnabled && schedulesOpenState;
  const libraryOpen = isLibraryEnabled && libraryOpenState;
  const sessionsOpen = sessionsOpenState;
  const setSessionsOpen = useCallback((open: boolean) => {
    if (open) {
      setSettingsOpenState(false);
      setLibraryOpenState(false);
      setLibraryAgentId(null);
      setSchedulesOpenState(false);
    } else {
      replaceSessionShareSearch({ view: null });
    }
    setSessionsOpenState(open);
  }, []);
  const setLibraryOpen = useCallback(
    (open: boolean) => {
      if (!isLibraryEnabled) return;
      if (open) {
        setSettingsOpenState(false);
        setSessionsOpen(false);
        setSchedulesOpenState(false);
      }
      setLibraryAgentId(null);
      setLibraryOpenState(open);
    },
    [isLibraryEnabled, setSessionsOpen],
  );
  const openLibraryAgent = useCallback(
    (agentId: string) => {
      if (!isLibraryEnabled) return;
      setSettingsOpenState(false);
      setSessionsOpen(false);
      setSchedulesOpenState(false);
      setLibraryOpenState(true);
      setLibraryAgentId(agentId);
    },
    [isLibraryEnabled, setSessionsOpen],
  );
  const closeLibraryAgent = useCallback(() => {
    setLibraryAgentId(null);
  }, []);
  const setSettingsOpen = useCallback(
    (open: boolean, section?: SettingsSection) => {
      if (section !== undefined) {
        setSettingsSection(section);
      }
      if (open) {
        setLibraryOpenState(false);
        setLibraryAgentId(null);
        setSessionsOpen(false);
        setSchedulesOpenState(false);
      }
      setSettingsOpenState(settingsEnabled && open);
    },
    [setSessionsOpen, settingsEnabled],
  );
  const setSchedulesOpen = useCallback(
    (open: boolean) => {
      if (open) {
        setSettingsOpenState(false);
        setLibraryOpenState(false);
        setLibraryAgentId(null);
        setSessionsOpen(false);
      }
      setSchedulesOpenState(schedulesEnabled && open);
    },
    [schedulesEnabled, setSessionsOpen],
  );

  useEffect(() => {
    if (!settingsEnabled) {
      setSettingsOpenState(false);
    }
  }, [settingsEnabled]);

  useEffect(() => {
    if (!schedulesEnabled) {
      setSchedulesOpenState(false);
    }
  }, [schedulesEnabled]);

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
        setLibraryOpenState(false);
        setLibraryAgentId(null);
        setSessionsOpen(false);
        setSchedulesOpen(false);
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
      setLibraryOpenState(false);
      setLibraryAgentId(null);
      setSessionsOpen(false);
      setSchedulesOpen(false);
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
    [isComposerEnabled, isLibraryEnabled, bumpEpoch, setSettingsOpen, setSessionsOpen, setSchedulesOpen],
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
    if (!isComposerEnabled) return;
    refreshCapabilities?.();
    selectLibraryAgent({ isMutable: true, agentSpec: mutableSeedRef.current });
  }, [isComposerEnabled, refreshCapabilities, selectLibraryAgent]);

  const sandboxEnabled = capabilities?.sandbox.enabled;
  const rememberDraftSpec = useCallback(
    (agentSpec: AgentSpec) => {
      const preferences = withCapabilitiesSandbox(selectDraftSpecPreferences(agentSpec), sandboxEnabled);
      rememberedSpecRef.current = preferences;
      mutableSeedRef.current = preferences;
      writeDraftSpecPreferences(preferences);
    },
    [sandboxEnabled],
  );

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
      setLibraryOpenState(false);
      setLibraryAgentId(null);
      setSessionsOpen(false);
      setSchedulesOpen(false);
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
    [
      isLibraryEnabled,
      isComposerEnabled,
      locked,
      lockedAgentName,
      bumpEpoch,
      setSettingsOpen,
      setSessionsOpen,
      setSchedulesOpen,
    ],
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

  const openLibraryHome = useCallback(() => {
    // Only pure Agents Library has an idle landing; other modes root via openDraft / clearChat.
    if (!isLibraryEnabled || isComposerEnabled) return;
    setPendingSessionId(undefined);
    setSettingsOpen(false);
    setLibraryOpenState(false);
    setLibraryAgentId(null);
    setSchedulesOpen(false);
    setMode({ status: 'idle' });
    bumpEpoch(false);
  }, [isLibraryEnabled, isComposerEnabled, setSettingsOpen, setSchedulesOpen, bumpEpoch]);

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
      settingsSection,
      setSettingsOpen,
      libraryOpen,
      libraryAgentId,
      setLibraryAgentId,
      setLibraryOpen,
      sessionsOpen,
      setSessionsOpen,
      openLibraryAgent,
      closeLibraryAgent,
      schedulesOpen,
      setSchedulesOpen,
      selectLibraryAgent,
      bindMutableAgent,
      selectAgent,
      openDraft,
      rememberDraftSpec,
      openHistorySession,
      clearChat,
      openLibraryHome,
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
      settingsSection,
      setSettingsOpen,
      libraryOpen,
      libraryAgentId,
      setLibraryOpen,
      sessionsOpen,
      setSessionsOpen,
      openLibraryAgent,
      closeLibraryAgent,
      schedulesOpen,
      setSchedulesOpen,
      selectLibraryAgent,
      bindMutableAgent,
      selectAgent,
      openDraft,
      rememberDraftSpec,
      openHistorySession,
      clearChat,
      openLibraryHome,
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
