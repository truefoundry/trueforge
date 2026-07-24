/**
 * In-memory registry of turns running in this process, keyed by session. A
 * session may have any number of concurrent turns; the registry makes no
 * attempt to enforce one turn per session (that would not hold across
 * replicas anyway). Cancel code aborts runs through their AbortControllers;
 * TurnHandle.stream() writes the terminal state when the signal fires.
 */
export class ActiveTurnRegistry {
  /** sessionId -> (turnId -> AbortController) */
  private readonly runs = new Map<string, Map<string, AbortController>>();

  /** Registers a running turn under its session. */
  register(input: { sessionId: string; turnId: string; abortController: AbortController }): void {
    let sessionRuns = this.runs.get(input.sessionId);
    if (!sessionRuns) {
      sessionRuns = new Map();
      this.runs.set(input.sessionId, sessionRuns);
    }
    sessionRuns.set(input.turnId, input.abortController);
  }

  /** Removes the entry once the turn's stream has fully drained. */
  finish(input: { sessionId: string; turnId: string }): void {
    const sessionRuns = this.runs.get(input.sessionId);
    if (!sessionRuns) {
      return;
    }
    sessionRuns.delete(input.turnId);
    if (sessionRuns.size === 0) {
      this.runs.delete(input.sessionId);
    }
  }

  /**
   * Aborts the given turn if it is running in this process. Returns true when
   * the run was found (already-aborted runs are not re-aborted). Cancelling a
   * turn that is not running is a no-op, mirroring the store's
   * first-terminal-write-wins rule.
   */
  cancelIfRunning(input: { sessionId: string; turnId: string; abortReason?: string }): boolean {
    const abortController = this.runs.get(input.sessionId)?.get(input.turnId);
    if (!abortController) {
      return false;
    }
    if (!abortController.signal.aborted) {
      abortController.abort(input.abortReason);
    }
    return true;
  }
}
