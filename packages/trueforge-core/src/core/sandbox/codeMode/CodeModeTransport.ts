import type { CodeModeDispatcher } from './CodeModeDispatcher';

/**
 * Code Mode channel. Construct eagerly with the dispatcher; connect/listen in `start`.
 * `start` may be called again after failure; `stop` is always valid after construct.
 */
export interface CodeModeTransport {
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
