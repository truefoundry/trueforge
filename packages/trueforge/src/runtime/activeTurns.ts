/**
 * In-memory registry of turns executing in this process. Keys are
 * `${sessionId}:${turnId}`. Cancel aborts via AbortController;
 * TurnHandle.stream() writes the terminal state when the signal fires.
 * `track()` owns registration and cleanup around the stream lifecycle.
 */
import { CancellationReason, TurnOffloadReason, type TurnHandle } from '@truefoundry/trueforge-core/agent-session';
import { Mutex } from 'async-mutex';

const DEFAULT_PAUSED_KEEPALIVE_MS = 30_000;

interface ActiveTurnRun {
  turn: TurnHandle;
  abortController: AbortController;
  waitUntilCompleted: Promise<void>;
  markCompleted: () => void;
}

function activeTurnKey(sessionId: string, turnId: string): string {
  return `${sessionId}:${turnId}`;
}

/** A test double may omit `state`. A real handle always has it. */
function isPausedRun(run: ActiveTurnRun | undefined): run is ActiveTurnRun {
  if (!run || !Object.hasOwn(run.turn, 'state')) {
    return false;
  }
  return run.turn.state.status === 'paused';
}

export class ActiveTurnRegistry {
  private readonly runs = new Map<string, ActiveTurnRun>();
  /** Per-turn mutex. Dropped once unlocked, which means no waiter is still queued. */
  private readonly turnLocks = new Map<string, Mutex>();
  private readonly keepaliveTimers = new Map<string, NodeJS.Timeout>();
  private readonly pausedKeepaliveMs: number;
  private alreadyShutDownAbortReason: CancellationReason | undefined;

  constructor(options?: { pausedKeepaliveMs?: number }) {
    this.pausedKeepaliveMs = options?.pausedKeepaliveMs ?? DEFAULT_PAUSED_KEEPALIVE_MS;
  }

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
      // TODO (chiragjn): support acquire timeout
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
      this.clearPausedKeepalive({ sessionId: input.turn.session_id, turnId: input.turn.id });
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
   * Abort a local run and wait until its drain has finished.
   * A paused generator is parked on the abort latch, so this unparks it and lets
   * the drain emit `turn.done`. Returns false when this process has no run.
   */
  async abortAndWait(input: { sessionId: string; turnId: string; abortReason: CancellationReason }): Promise<boolean> {
    const run = this.runs.get(activeTurnKey(input.sessionId, input.turnId));
    if (!run) {
      return false;
    }
    if (!run.abortController.signal.aborted) {
      run.abortController.abort(input.abortReason);
    }
    await run.waitUntilCompleted;
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
   * After a turn pauses, keep the run for `pausedKeepaliveMs`. On expiry, offload
   * under the turn lock: the generator stops without a terminal write.
   * A later send on this owner rebuilds. `0` disables the timer.
   */
  armPausedKeepalive(input: { sessionId: string; turnId: string }): void {
    this.clearPausedKeepalive(input);
    if (this.pausedKeepaliveMs <= 0 || this.alreadyShutDownAbortReason !== undefined) {
      return;
    }
    const key = activeTurnKey(input.sessionId, input.turnId);
    const timer = setTimeout(() => {
      this.keepaliveTimers.delete(key);
      void this.withTurnLock(input, async () => {
        const run = this.runs.get(key);
        if (!isPausedRun(run)) {
          return;
        }
        await this.finishRun(run, TurnOffloadReason);
      });
    }, this.pausedKeepaliveMs);
    timer.unref();
    this.keepaliveTimers.set(key, timer);
  }

  clearPausedKeepalive(input: { sessionId: string; turnId: string }): void {
    const key = activeTurnKey(input.sessionId, input.turnId);
    const timer = this.keepaliveTimers.get(key);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.keepaliveTimers.delete(key);
  }

  /**
   * Abort the local run and wait until it leaves the registry.
   * Caller must already hold the per-turn lock. Offload does not write a terminal state.
   */
  async dropLocalTurn(input: { sessionId: string; turnId: string }): Promise<void> {
    const run = this.runs.get(activeTurnKey(input.sessionId, input.turnId));
    if (!run) {
      return;
    }
    await this.finishRun(run, TurnOffloadReason);
  }

  /**
   * Enter shutdown mode and wait until the registry is empty.
   * Paused runs are offloaded so their approval state survives. Running runs abort as `abortReason`.
   * Late `track()` calls abort immediately as `abortReason`.
   */
  async shutdownAndWait(abortReason: CancellationReason): Promise<void> {
    this.alreadyShutDownAbortReason = abortReason;
    for (const timer of this.keepaliveTimers.values()) {
      clearTimeout(timer);
    }
    this.keepaliveTimers.clear();
    while (this.runs.size > 0) {
      const pending = Array.from(this.runs.values());
      for (const run of pending) {
        if (run.abortController.signal.aborted) {
          continue;
        }
        const reason = isPausedRun(run) ? TurnOffloadReason : abortReason;
        run.abortController.abort(reason);
      }
      await Promise.allSettled(pending.map(run => run.waitUntilCompleted));
    }
  }

  private async finishRun(run: ActiveTurnRun, reason: CancellationReason | typeof TurnOffloadReason): Promise<void> {
    if (!run.abortController.signal.aborted) {
      run.abortController.abort(reason);
    }
    await run.waitUntilCompleted;
  }
}
