/**
 * In-memory registry of turns executing in this process. Keys are
 * `${sessionId}:${turnId}`. Cancel aborts via AbortController;
 * TurnHandle.stream() writes the terminal state when the signal fires.
 * `track()` owns registration and cleanup around the stream lifecycle.
 */
import { CancellationReason, TurnOffloadReason, type TurnHandle } from '@truefoundry/trueforge-core/agent-session';
import { Mutex } from 'async-mutex';

const DEFAULT_PAUSED_KEEPALIVE_MS = 300_000;

interface ActiveTurnRun {
  /** Absent until `track()` attaches the stream. A reserved rebuild has no handle yet. */
  turn: TurnHandle | undefined;
  /** A rebuild reserved before `track()`. The row is paused, so shutdown offloads it. */
  reservedPaused: boolean;
  abortController: AbortController;
  waitUntilCompleted: Promise<void>;
  markCompleted: () => void;
}

function activeTurnKey(sessionId: string, turnId: string): string {
  return `${sessionId}:${turnId}`;
}

function isPausedRun(run: ActiveTurnRun | undefined): run is ActiveTurnRun {
  if (!run) {
    return false;
  }
  if (run.turn) {
    return run.turn.state.status === 'paused';
  }
  return run.reservedPaused;
}

export class ActiveTurnRegistry {
  private readonly runs = new Map<string, ActiveTurnRun>();
  /** Per-turn mutex. Dropped once unlocked, which means no waiter is still queued. */
  private readonly turnLocks = new Map<string, Mutex>();
  // active turns keepalive timers, whenever turn is paused, we start a timer to keep the turn alive for a certain amount of time
  // if the timer expires, we offload the turn
  private readonly keepaliveTimers = new Map<string, NodeJS.Timeout>();
  // the time to keep the turn alive for, in milliseconds
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
   * exits early). If shutdown has already begun, a paused turn is offloaded and
   * any other turn is aborted with the shutdown reason.
   */
  track<T>(input: { abortController: AbortController; stream: AsyncIterable<T>; turn: TurnHandle }): AsyncGenerator<T> {
    const key = activeTurnKey(input.turn.session_id, input.turn.id);
    const existing = this.runs.get(key);
    let run: ActiveTurnRun;
    if (existing) {
      // A reserved rebuild adopts this stream. Replacing the run would leave shutdown
      // waiting on a promise nothing resolves.
      if (existing.turn !== undefined || existing.abortController !== input.abortController) {
        throw new Error(`Turn ${input.turn.id} is already registered in this process`);
      }
      existing.turn = input.turn;
      existing.reservedPaused = false;
      run = existing;
    } else {
      const { promise: waitUntilCompleted, resolve } = Promise.withResolvers<undefined>();
      const markCompleted = (): void => {
        resolve(undefined);
      };
      run = {
        abortController: input.abortController,
        waitUntilCompleted,
        markCompleted,
        turn: input.turn,
        reservedPaused: false,
      };
      this.runs.set(key, run);
    }

    // Accepted HTTP may still call track() after shutdownAndWait snapshotted.
    // Offload a paused turn so its row survives. Abort any other turn with the shutdown reason.
    if (this.alreadyShutDownAbortReason !== undefined && !input.abortController.signal.aborted) {
      const reason = isPausedRun(run) ? TurnOffloadReason : this.alreadyShutDownAbortReason;
      input.abortController.abort(reason);
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
   * The live turn handle for a turn executing in this process, or undefined when it is not
   * resumable here — never started, already terminal (the stream removed its run), aborting,
   * or still only reserved for a rebuild.
   * An aborted run stays registered until its drain finishes. Call `waitForDrainingRun` before
   * rebuilding so a second generator does not write with the same executor id.
   */
  getTurnHandle(input: { sessionId: string; turnId: string }): TurnHandle | undefined {
    const run = this.runs.get(activeTurnKey(input.sessionId, input.turnId));
    if (!run?.turn) {
      return undefined;
    }
    if (run.abortController.signal.aborted) {
      return undefined;
    }
    return run.turn;
  }

  /**
   * Wait until an aborted run has left the registry.
   * The caller holds the per-turn lock. The drain does not, so this does not deadlock.
   * A live run is left alone.
   */
  async waitForDrainingRun(input: { sessionId: string; turnId: string }): Promise<void> {
    const run = this.runs.get(activeTurnKey(input.sessionId, input.turnId));
    if (!run?.abortController.signal.aborted) {
      return;
    }
    await run.waitUntilCompleted;
  }

  /**
   * Register a paused rebuild before its stream exists.
   * Cancel and shutdown can see the controller. `track()` attaches the stream to this same run.
   * Call `releaseReservedTurn` when the stream will never start.
   */
  reservePausedTurn(input: { sessionId: string; turnId: string; abortController: AbortController }): void {
    const key = activeTurnKey(input.sessionId, input.turnId);
    if (this.runs.has(key)) {
      throw new Error(`Turn ${input.turnId} is already registered in this process`);
    }
    const { promise: waitUntilCompleted, resolve } = Promise.withResolvers<undefined>();
    const markCompleted = (): void => {
      resolve(undefined);
    };
    this.runs.set(key, {
      turn: undefined,
      reservedPaused: true,
      abortController: input.abortController,
      waitUntilCompleted,
      markCompleted,
    });
    if (this.alreadyShutDownAbortReason !== undefined && !input.abortController.signal.aborted) {
      input.abortController.abort(TurnOffloadReason);
    }
  }

  /** Drop a reserved rebuild whose stream never started, and unblock shutdown waiting on it. */
  releaseReservedTurn(input: { sessionId: string; turnId: string }): void {
    const key = activeTurnKey(input.sessionId, input.turnId);
    const run = this.runs.get(key);
    if (!run || run.turn !== undefined) {
      return;
    }
    this.runs.delete(key);
    run.markCompleted();
  }

  /**
   * After a turn pauses, keep the run for `pausedKeepaliveMs`. On expiry, offload
   * under the turn lock: the generator stops without a terminal write.
   * A later send on this owner rebuilds. `0` disables the timer.
   */
  startPausedKeepalive(input: { sessionId: string; turnId: string }): void {
    this.clearPausedKeepalive(input);
    if (this.pausedKeepaliveMs <= 0 || this.alreadyShutDownAbortReason !== undefined) {
      return;
    }
    const key = activeTurnKey(input.sessionId, input.turnId);
    const timer = setTimeout(() => {
      void this.withTurnLock(input, async () => {
        // A send may have cleared or replaced this timer while the callback waited for the lock.
        if (this.keepaliveTimers.get(key) !== timer) {
          return;
        }
        this.keepaliveTimers.delete(key);
        const run = this.runs.get(key);
        if (isPausedRun(run)) {
          await this.finishRun(run, TurnOffloadReason);
        }
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
   * Does not take the per-turn lock. Paused runs, including a reserved rebuild, are offloaded
   * directly so their approval state survives. Running runs abort as `abortReason`.
   * A later `track()` offloads a paused turn and aborts any other turn as `abortReason`.
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
