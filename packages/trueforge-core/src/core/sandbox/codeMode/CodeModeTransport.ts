import type { CodeModeDispatcher } from './CodeModeDispatcher';

/** Payload for installing the Code Mode MCP client into a sandbox filesystem. */
export interface CodeModeClientInstall {
  /** UTF-8 Python source (installed as mcp_client.py). */
  content: string;
  /** Absolute path for the Python module file inside the sandbox FS. */
  remotePath: string;
  /**
   * Optional extra CLI symlink on the default PATH (Daytona: `/usr/local/bin/mcp-client`).
   * Layout bin link is always `dirname(remotePath)/bin/mcp-client` (Sandbox-derived).
   */
  pathBinSymlink?: string | undefined;
}

/**
 * Code Mode channel. Construct eagerly with the dispatcher; connect/listen in `start`.
 * `start` may be called again after failure; `stop` is always valid after construct.
 */
export interface CodeModeTransport {
  /**
   * MCP client script + install path for this transport (sync; no listen required).
   * Sandbox applies the install during init; channel env still comes from `start`.
   */
  getClientInstall(params: { sandboxId: string }): CodeModeClientInstall;
  /**
   * Lazy connect/listen; may be called again after a failed attempt (non-sticky).
   * Idempotent once successfully started.
   */
  start(params: { codeModeDispatcher: CodeModeDispatcher; sandboxId: string; requestTimeoutSeconds: number }): Promise<{
    env: Record<string, string>;
  }>;
  /** Best-effort teardown whether start succeeded, failed, or never ran. */
  stop(): Promise<void>;
}
