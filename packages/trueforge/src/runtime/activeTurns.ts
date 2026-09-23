/**
 * In-memory registry of turns executing in this process. Keys are
 * `${sessionId}:${turnId}`. Cancel aborts via AbortController;
 * TurnHandle.stream() writes the terminal state when the signal fires.
 * `track()` owns registration and cleanup around the stream lifecycle.
 */
import { CancellationReason } from '@truefoundry/trueforge-core/agent-session';
import { Mutex } from 'async-mutex';

interface ActiveTurnRun {
  abortController: AbortController;
  waitUntilCompleted: Promise<void>;
  markCompleted: () => void;
}

function activeTurnKey(sessionId: string, turnId: string): string {
  return `${sessionId}:${turnId}`;
}

export class ActiveTurnRegistry {
  private readonly runs = new Map<string, ActiveTurnRun>();
  private readonly locks = new Map<string, Mutex>();
  private alreadyShutDownAbortReason: CancellationReason | undefined;

  /**
   * Serialize work for one turn in this process. Waiters queue; different keys
   * run in parallel.
   */
  async withTurnLock<T>(input: { sessionId: string; turnId: string }, fn: () => Promise<T>): Promise<T> {
    const key = activeTurnKey(input.sessionId, input.turnId);
    const mutex = this.locks.get(key) ?? new Mutex();
    this.locks.set(key, mutex);
    try {
      return await mutex.runExclusive(fn);
    } finally {
      if (!mutex.isLocked() && this.locks.get(key) === mutex) {
        this.locks.delete(key);
      }
    }
  }

  /**
   * Registers the run immediately, then returns a generator that forwards
   * `stream` and removes the run when the stream completes (or the consumer
   * exits early). If shutdown has already begun, aborts the controller with
   * the shutdown reason so the turn ends as abandoned.
   */
  track<T>(input: {
    sessionId: string;
    turnId: string;
    abortController: AbortController;
    stream: AsyncIterable<T>;
  }): AsyncGenerator<T> {
    const key = activeTurnKey(input.sessionId, input.turnId);
    const { promise: waitUntilCompleted, resolve } = Promise.withResolvers<undefined>();
    const markCompleted = (): void => {
      resolve(undefined);
    };
    const run: ActiveTurnRun = {
      abortController: input.abortController,
      waitUntilCompleted,
      markCompleted,
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

  has(input: { sessionId: string; turnId: string }): boolean {
    return this.runs.has(activeTurnKey(input.sessionId, input.turnId));
  }

  /**
   * Aborts the turn if it is tracked here. Missing and already-aborted runs
   * are a no-op (first abort wins).
   */
  cancel(input: { sessionId: string; turnId: string; abortReason: CancellationReason }): void {
    const run = this.runs.get(activeTurnKey(input.sessionId, input.turnId));
    if (!run || run.abortController.signal.aborted) {
      return;
    }
    run.abortController.abort(input.abortReason);
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
