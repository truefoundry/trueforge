import type { AgentConfig, ShellMode } from '../server/ShellModeContext.js';

/**
 * A navigable place in the chat shell. The router mirrors these to the URL;
 * shell state stays the source of truth.
 */
export type RoutePlace =
  | { type: 'root' }
  | { type: 'agent'; agentName: string }
  | { type: 'session'; sessionId: string }
  | { type: 'settings' }
  | { type: 'library' }
  | { type: 'libraryAgent'; agentId: string }
  | { type: 'sessionsBrowser' }
  | { type: 'schedules' };

/**
 * Host-facing route path customization. Only honored when `withRouter`.
 * The shell owns the pathname only; query string and hash are left untouched.
 */
export type RoutesConfig = {
  /** Passed to the router; not used for our own match/build (router strips it). */
  basename?: string;
  /** `agent` and `session` templates MUST keep their `:param` segment to stay addressable. */
  paths?: {
    /** New-chat / landing. Default `'/'`. */
    root?: string;
    /** Settings overlay. `false` keeps settings overlay-only (no URL). Default `'/settings'`. */
    settings?: string | false;
    /** Agents overlay. `false` keeps library overlay-only (no URL). Default `'/library'`. */
    library?: string | false;
    /** Agent detail under the library. Default `'/library/:agentId'`. */
    libraryAgent?: string | false;
    /** Schedules page. `false` keeps schedules overlay-only (no URL). Default `'/schedules'`. */
    schedules?: string | false;
    /** Immutable "Try" agent. `false` disables. Default `'/agents/:agentName'`. */
    agent?: string | false;
    /** Session deep link. `false` disables. Default `'/sessions/:sessionId'`. */
    session?: string | false;
    /** All-user sessions browser. `false` disables. Default `'/sessions'`. */
    sessionsBrowser?: string | false;
  };
};

/** Fully-resolved templates with defaults applied. `null` = that place has no URL. */
export type ResolvedRoutes = {
  basename: string;
  root: string;
  settings: string | null;
  library: string | null;
  libraryAgent: string | null;
  schedules: string | null;
  agent: string | null;
  session: string | null;
  sessionsBrowser: string | null;
};

/** Inputs for deriving the current place from shell + runtime state. */
export type ShellSnapshot = {
  settingsOpen: boolean;
  libraryOpen: boolean;
  sessionsOpen: boolean;
  libraryAgentId: string | null;
  schedulesOpen: boolean;
  pendingSessionId?: string;
  /** Remote id of the active thread once a fresh chat is persisted. */
  activeRemoteId?: string;
  mode: ShellMode;
  agentConfigMode: AgentConfig['mode'];
};
