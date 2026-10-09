/**
 * In-memory registry of turns executing in this process. Keys are
 * `${sessionId}:${turnId}`. Cancel aborts via AbortController;
 * TurnHandle.stream() writes the terminal state when the signal fires.
 * `track()` owns registration and cleanup around the stream lifecycle.
 */
import { CancellationReason, type TurnHandle } from '@truefoundry/trueforge-core/agent-session';
import { Mutex } from 'async-mutex';

interface ActiveTurnRun {
  turn: TurnHandle;
  abortController: AbortController;
  waitUntilCompleted: Promise<void>;
  markCompleted: () => void;
}

function activeTurnKey(sessionId: string, turnId: string): string {
  return `${sessionId}:${turnId}`;
}

export class ActiveTurnRegistry {
  private readonly runs = new Map<string, ActiveTurnRun>();
  /** Per-turn mutex. Dropped once unlocked, which means no waiter is still queued. */
  private readonly turnLocks = new Map<string, Mutex>();
  private alreadyShutDownAbortReason: CancellationReason | undefined;

  /**
   * Runs `fn` while holding the per-turn lock, after every earlier holder of
   * the same turn has released it. Different turns never wait on each other.
   * Callers MUST re-read registry state inside `fn` instead of trusting a
   * lookup made before acquiring the lock.
   */
  async withTurnLock<T>(input: { sessionId: string; turnId: string }, fn: () => Promise<T>): Promise<T> {
    const key = activeTurnKey(input.sessionId, input.turnId);
    const existing = this.turnLocks.get(key);
    const mutex = existing ?? new Mutex();
    if (!existing) {
      this.turnLocks.set(key, mutex);
    }
    try {
      return await mutex.runExclusive(fn);
    } finally {
      if (!mutex.isLocked()) {
        this.turnLocks.delete(key);
      }
    }
  }

  /**
   * Registers the run immediately, then returns a generator that forwards
   * `stream` and removes the run when the stream completes (or the consumer
   * exits early). If shutdown has already begun, aborts the controller with
   * the shutdown reason so the turn ends as abandoned.
   */
  track<T>(input: { abortController: AbortController; stream: AsyncIterable<T>; turn: TurnHandle }): AsyncGenerator<T> {
    const key = activeTurnKey(input.turn.session_id, input.turn.id);
    const { promise: waitUntilCompleted, resolve } = Promise.withResolvers<undefined>();
    const markCompleted = (): void => {
      resolve(undefined);
    };
    const run: ActiveTurnRun = {
      abortController: input.abortController,
      waitUntilCompleted,
      markCompleted,
      turn: input.turn,
    };
    this.runs.set(key, run);

    // Accepted HTTP may still call track() after shutdownAndWait snapshotted;
    // abort immediately so the turn ends as abandoned instead of running past exit.
    if (this.alreadyShutDownAbortReason !== undefined) {
      if (!input.abortController.signal.aborted) {
        input.abortController.abort(this.alreadyShutDownAbortReason);
      }
    }

    const complete = () => {
      run.markCompleted();
      if (this.runs.get(key) === run) {
        this.runs.delete(key);
      }
    };
    async function* tracked(): AsyncGenerator<T> {
      try {
        yield* input.stream;
      } finally {
        complete();
      }
    }
    return tracked();
  }

  /**
   * Aborts the given turn if it is running in this process. Returns true when
   * the run was found (already-aborted runs are not re-aborted). Cancelling a
   * turn that is not running is a no-op, mirroring the store's
   * first-terminal-write-wins rule.
   */
  cancelIfRunning(input: { sessionId: string; turnId: string; abortReason: CancellationReason }): boolean {
    const run = this.runs.get(activeTurnKey(input.sessionId, input.turnId));
    if (!run) {
      return false;
    }
    if (!run.abortController.signal.aborted) {
      run.abortController.abort(input.abortReason);
    }
    return true;
  }

  /**
   * The live turn handle for a turn executing in this process, or undefined when it is not
   * resumable here — never started, already terminal (the stream removed its run), aborting, or
   * registered without a handle.
   */
  getTurnHandle(input: { sessionId: string; turnId: string }): TurnHandle | undefined {
    const run = this.runs.get(activeTurnKey(input.sessionId, input.turnId));
    if (!run) {
      return undefined;
    }
    if (run.abortController.signal.aborted) {
      return undefined;
    }
    return run.turn;
  }

  /**
   * Enter shutdown mode, abort every run with `abortReason`, and wait until the
   * registry is empty. Late `track()` calls (in-flight HTTP that registered after
   * the first snapshot) are aborted immediately as `abortReason` and included in
   * subsequent wait iterations.
   */
  async shutdownAndWait(abortReason: CancellationReason): Promise<void> {
    this.alreadyShutDownAbortReason = abortReason;
    while (this.runs.size > 0) {
      const pending = Array.from(this.runs.values());
      for (const run of pending) {
        if (!run.abortController.signal.aborted) {
          run.abortController.abort(abortReason);
        }
      }
      await Promise.allSettled(pending.map(run => run.waitUntilCompleted));
    }
  }
}
