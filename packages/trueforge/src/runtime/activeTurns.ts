/**
 * In-memory registry of turns executing in this process. Keys are
 * `${sessionId}:${turnId}`. Cancel aborts via AbortController;
 * TurnHandle.stream() writes the terminal state when the signal fires.
 * `track()` owns registration and cleanup around the stream lifecycle.
 */
import { CancellationReason, TurnOffloadReason, type TurnHandle } from '@truefoundry/trueforge-core/agent-session';
import { getOperationMetrics } from '@truefoundry/trueforge-core/core';
import { E_TIMEOUT, Mutex, withTimeout } from 'async-mutex';
import type { Logger } from 'winston';

const DEFAULT_PAUSED_KEEPALIVE_MS = 300_000;
/** `0` waits until the lock is free. A positive value is the acquire budget in milliseconds. */
const DEFAULT_LOCK_ACQUIRE_TIMEOUT_MS = 0;

interface TurnRunCompletion {
  abortController: AbortController;
  waitUntilCompleted: Promise<void>;
  markCompleted: () => void;
}

/** Paused rebuild before `rebuildTurn` returns a handle. Shutdown offloads this phase. */
interface RebuildingTurnRun extends TurnRunCompletion {
  phase: 'rebuilding';
}

interface LiveTurnRun<TTransaction> extends TurnRunCompletion {
  phase: 'live';
  turn: TurnHandle<TTransaction>;
}

type ActiveTurnRun<TTransaction> = RebuildingTurnRun | LiveTurnRun<TTransaction>;

/** `withTurnLock` did not acquire the per-turn lock before `timeoutMs`. */
export class TurnLockAcquireTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(options: { timeoutMs: number; cause: Error }) {
    super(`Timed out acquiring the turn lock after ${String(options.timeoutMs)}ms`, { cause: options.cause });
    this.name = 'TurnLockAcquireTimeoutError';
    this.timeoutMs = options.timeoutMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function setupTurnRun(abortController: AbortController): TurnRunCompletion {
  const { promise: waitUntilCompleted, resolve } = Promise.withResolvers<undefined>();
  const markCompleted = (): void => {
    resolve(undefined);
  };
  return { abortController, waitUntilCompleted, markCompleted };
}

function activeTurnKey(sessionId: string, turnId: string): string {
  return `${sessionId}:${turnId}`;
}

function isPausedRun<TTransaction>(run: ActiveTurnRun<TTransaction> | undefined): run is ActiveTurnRun<TTransaction> {
  if (!run) {
    return false;
  }
  if (run.phase === 'rebuilding') {
    return true;
  }
  return run.turn.state.status === 'paused';
}

export class ActiveTurnRegistry<TTransaction = never> {
  private readonly runs = new Map<string, ActiveTurnRun<TTransaction>>();
  /** Per-turn mutex. Dropped once unlocked, which means no waiter is still queued. */
  private readonly turnLocks = new Map<string, Mutex>();
  // active turns keepalive timers, whenever turn is paused, we start a timer to keep the turn alive for a certain amount of time
  // if the timer expires, we offload the turn
  private readonly keepaliveTimers = new Map<string, NodeJS.Timeout>();
  // the time to keep the turn alive for, in milliseconds
  private readonly pausedKeepaliveMs: number;
  /** Milliseconds to wait for the per-turn lock. `0` waits without a timeout. */
  private readonly lockAcquireTimeoutMs: number;
  private readonly logger: Logger;
  private alreadyShutDownAbortReason: CancellationReason | undefined;

  constructor(options: { logger: Logger; pausedKeepaliveMs?: number; lockAcquireTimeoutMs?: number }) {
    this.pausedKeepaliveMs = options.pausedKeepaliveMs ?? DEFAULT_PAUSED_KEEPALIVE_MS;
    this.lockAcquireTimeoutMs = options.lockAcquireTimeoutMs ?? DEFAULT_LOCK_ACQUIRE_TIMEOUT_MS;
    this.logger = options.logger.child({ module: 'ActiveTurnRegistry' });
  }

  /**
   * Runs `fn` while holding the per-turn lock, after every earlier holder of
   * the same turn has released it. Different turns never wait on each other.
   * Callers MUST re-read registry state inside `fn` instead of trusting a
   * lookup made before acquiring the lock.
   * `lockAcquireTimeoutMs` of 0 waits until the lock is free. A positive value
   * throws `TurnLockAcquireTimeoutError` when the wait exceeds it.
   */
  async withTurnLock<T>(input: { sessionId: string; turnId: string }, fn: () => Promise<T>): Promise<T> {
    const key = activeTurnKey(input.sessionId, input.turnId);
    const existing = this.turnLocks.get(key);
    const mutex = existing ?? new Mutex();
    if (!existing) {
      this.turnLocks.set(key, mutex);
    }
    // 0 waits forever. withTimeout(0) would reject on the next timer turn.
    const guarded = this.lockAcquireTimeoutMs > 0 ? withTimeout(mutex, this.lockAcquireTimeoutMs) : mutex;
    try {
      return await guarded.runExclusive(fn);
    } catch (caught) {
      if (caught === E_TIMEOUT) {
        throw new TurnLockAcquireTimeoutError({
          timeoutMs: this.lockAcquireTimeoutMs,
          cause: caught,
        });
      }
      throw caught;
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
  track<T>(input: {
    abortController: AbortController;
    stream: AsyncIterable<T>;
    turn: TurnHandle<TTransaction>;
  }): AsyncGenerator<T> {
    const key = activeTurnKey(input.turn.session_id, input.turn.id);
    const existing = this.runs.get(key);
    let run: LiveTurnRun<TTransaction>;
    if (existing) {
      // Keep the rebuilding run's completion promise. Shutdown may already be waiting on it
      // and does not re-read this map entry.
      if (existing.phase !== 'rebuilding' || existing.abortController !== input.abortController) {
        throw new Error(`Turn ${input.turn.id} is already registered in this process`);
      }
      run = {
        phase: 'live',
        turn: input.turn,
        abortController: existing.abortController,
        waitUntilCompleted: existing.waitUntilCompleted,
        markCompleted: existing.markCompleted,
      };
      this.runs.set(key, run);
    } else {
      run = {
        phase: 'live',
        turn: input.turn,
        ...setupTurnRun(input.abortController),
      };
      this.runs.set(key, run);
      getOperationMetrics()?.recordActiveTurns({ delta: 1 });
    }

    // Accepted HTTP may still call track() after shutdownAndWait snapshotted.
    // Offload a paused turn so its row survives. Abort any other turn with the shutdown reason.
    if (this.alreadyShutDownAbortReason !== undefined && !input.abortController.signal.aborted) {
      const offload = isPausedRun(run);
      if (offload) {
        this.logger.info('Offloading paused turn', { cause: 'shutdown' });
      }
      input.abortController.abort(offload ? TurnOffloadReason : this.alreadyShutDownAbortReason);
    }

    const complete = () => {
      this.clearPausedKeepalive({ sessionId: input.turn.session_id, turnId: input.turn.id });
      run.markCompleted();
      getOperationMetrics()?.recordActiveTurns({ delta: -1 });
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
   * or still in the rebuilding phase.
   * An aborted run stays registered until its drain finishes. `isCancelled` tells a
   * send to reject instead of rebuilding over that drain.
   */
  getTurnHandle(input: { sessionId: string; turnId: string }): TurnHandle<TTransaction> | undefined {
    const run = this.runs.get(activeTurnKey(input.sessionId, input.turnId));
    if (run?.phase !== 'live') {
      return undefined;
    }
    // we hide the turn from the client if it was already aborted
    // so that the client does not try to send events to it
    if (run.abortController.signal.aborted) {
      return undefined;
    }
    return run.turn;
  }

  /**
   * True when a local run was aborted with a cancellation reason.
   * Offload is not a cancellation, so the caller may rebuild.
   * Cancel does not take the turn lock and does not wait for the drain, and `getTurnHandle`
   * hides the aborted run. The row can still look paused. The caller rejects the send
   * instead of starting a second generator with the same executor id.
   */
  isCancelled(input: { sessionId: string; turnId: string }): boolean {
    const run = this.runs.get(activeTurnKey(input.sessionId, input.turnId));
    if (!run?.abortController.signal.aborted) {
      return false;
    }
    const { signal } = run.abortController;
    return (
      signal.reason === CancellationReason.ServerExecutionTimeout ||
      signal.reason === CancellationReason.CancelledForNextTurn ||
      signal.reason === CancellationReason.Abandoned ||
      signal.reason === CancellationReason.ClientCancelled
    );
  }

  /**
   * Insert a rebuilding run before its stream exists.
   * Cancel and shutdown can see the controller. `track()` replaces it with a live run
   * that keeps this completion promise.
   * Call `releaseReservedTurn` when the stream will never start.
   */
  reservePausedTurn(input: { sessionId: string; turnId: string; abortController: AbortController }): void {
    const key = activeTurnKey(input.sessionId, input.turnId);
    if (this.runs.has(key)) {
      throw new Error(`Turn ${input.turnId} is already registered in this process`);
    }
    const run: RebuildingTurnRun = {
      phase: 'rebuilding',
      ...setupTurnRun(input.abortController),
    };
    this.runs.set(key, run);
    getOperationMetrics()?.recordActiveTurns({ delta: 1 });
    // Resume can insert this run after shutdownAndWait snapshotted `runs` or already returned.
    // Abort now so rebuilding does not start a stream that loop will never run.
    if (this.alreadyShutDownAbortReason !== undefined && !input.abortController.signal.aborted) {
      this.logger.info('Offloading paused turn', { cause: 'shutdown' });
      input.abortController.abort(TurnOffloadReason);
    }
  }

  /** Drop a rebuilding run whose stream never started, and unblock shutdown waiting on it. */
  releaseReservedTurn(input: { sessionId: string; turnId: string }): void {
    const key = activeTurnKey(input.sessionId, input.turnId);
    const run = this.runs.get(key);
    if (run?.phase !== 'rebuilding') {
      return;
    }
    this.runs.delete(key);
    run.markCompleted();
    getOperationMetrics()?.recordActiveTurns({ delta: -1 });
  }

  /**
   * After a turn pauses, keep the run for `pausedKeepaliveMs`. On expiry, offload
   * under the turn lock: the generator stops without a terminal write.
   * A later send on this owner rebuilds. `0` disables the timer.
   */
  startPausedKeepalive(input: { sessionId: string; turnId: string }): void {
    const replaced = this.discardPausedKeepalive(input);
    if (this.pausedKeepaliveMs <= 0 || this.alreadyShutDownAbortReason !== undefined) {
      if (replaced) {
        this.logger.info('Paused keepalive cleared', { pausedKeepaliveMs: this.pausedKeepaliveMs });
      }
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
          this.logger.info('Offloading paused turn', { cause: 'keepalive' });
          await this.finishRun(run, TurnOffloadReason);
          return;
        }
        this.logger.info('Paused keepalive expired; turn is no longer paused');
      });
    }, this.pausedKeepaliveMs);
    timer.unref();
    this.keepaliveTimers.set(key, timer);
    this.logger.info(replaced ? 'Paused keepalive restarted' : 'Paused keepalive started', {
      pausedKeepaliveMs: this.pausedKeepaliveMs,
    });
  }

  clearPausedKeepalive(input: { sessionId: string; turnId: string }): void {
    if (!this.discardPausedKeepalive(input)) {
      return;
    }
    this.logger.info('Paused keepalive cleared');
  }

  private discardPausedKeepalive(input: { sessionId: string; turnId: string }): boolean {
    const key = activeTurnKey(input.sessionId, input.turnId);
    const timer = this.keepaliveTimers.get(key);
    if (!timer) {
      return false;
    }
    clearTimeout(timer);
    this.keepaliveTimers.delete(key);
    return true;
  }

  /**
   * Stop a local generator left behind after the row's executor moved.
   * The abort reason tells the drain not to write that row.
   */
  async dropLocalTurn(input: { sessionId: string; turnId: string }): Promise<void> {
    const run = this.runs.get(activeTurnKey(input.sessionId, input.turnId));
    if (!run) {
      return;
    }
    if (!run.abortController.signal.aborted) {
      this.logger.info('Offloading paused turn', { cause: 'not-owner' });
    }
    await this.finishRun(run, TurnOffloadReason);
  }

  /**
   * Enter shutdown mode and wait until the registry is empty.
   * Does not take the per-turn lock.
   * A send holds it across rebuild and `dropLocalTurn`;
   * Keepalive holds it across `finishRun`.
   * Waiting for the lock would defer the abort until those calls returned,
   * so it could not interrupt them.
   * Paused live runs and rebuilding runs are offloaded so their approval state survives.
   */
  async shutdownAndWait(abortReason: CancellationReason): Promise<void> {
    this.alreadyShutDownAbortReason = abortReason;
    const timerCount = this.keepaliveTimers.size;
    for (const timer of this.keepaliveTimers.values()) {
      clearTimeout(timer);
    }
    this.keepaliveTimers.clear();
    if (timerCount > 0) {
      this.logger.info('Cleared paused keepalive timers for shutdown', { timerCount });
    }
    while (this.runs.size > 0) {
      const pending = Array.from(this.runs.values());
      for (const run of pending) {
        if (run.abortController.signal.aborted) {
          continue;
        }
        const offload = isPausedRun(run);
        if (offload) {
          this.logger.info('Offloading paused turn', { cause: 'shutdown' });
        }
        run.abortController.abort(offload ? TurnOffloadReason : abortReason);
      }
      await Promise.allSettled(pending.map(run => run.waitUntilCompleted));
    }
  }

  private async finishRun(
    run: ActiveTurnRun<TTransaction>,
    reason: CancellationReason | typeof TurnOffloadReason,
  ): Promise<void> {
    if (!run.abortController.signal.aborted) {
      run.abortController.abort(reason);
    }
    await run.waitUntilCompleted;
  }
}
