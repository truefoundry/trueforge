/**
 * In-memory registry of turns executing in this process. Keys are
 * `${sessionId}:${turnId}`. Cancel aborts via AbortController;
 * TurnHandle.stream() writes the terminal state when the signal fires.
 * `track()` owns registration and cleanup around the stream lifecycle.
 */
import { CancellationReason } from '@truefoundry/utils/agent-session';
import { HTTPException } from 'hono/http-exception';
import configuration from '../config';
import { PromiseTimeoutError, withTimeout } from './promises';

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
  private alreadyShutDownAbortReason: CancellationReason | undefined;

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

  /**
   * Aborts the turn if it runs in this process and waits for its teardown, so
   * true means the run is actually gone. Returns false when nothing was
   * running; throws HTTPException(424) when teardown exceeds the timeout.
   */
  async cancelIfRunning(input: {
    sessionId: string;
    turnId: string;
    abortReason: CancellationReason;
  }): Promise<boolean> {
    const run = this.runs.get(activeTurnKey(input.sessionId, input.turnId));
    if (!run) {
      return false;
    }
    if (!run.abortController.signal.aborted) {
      run.abortController.abort(input.abortReason);
    }
    try {
      await withTimeout(run.waitUntilCompleted, configuration.CANCEL_TEARDOWN_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof PromiseTimeoutError) {
        throw new HTTPException(424, { message: 'Timed out waiting for execution to cancel' });
      }
      throw error;
    }
    return true;
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
