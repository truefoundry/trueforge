/**
 * The controller: a set of periodic control loops and the timers that drive them.
 *
 * Loops are independent — each has its own interval, its own re-entrancy guard, and
 * its own error boundary, so a slow or failing loop cannot stall another.
 *
 * The controller runs in exactly ONE process per database. In standalone mode that is
 * the server itself; when `STANDALONE=false` it is the dedicated single-replica
 * process. Loops are written assuming this.
 */
import type { Logger } from 'winston';

/** Reason passed to {@link AbortController.abort} when {@link Controller.stop} runs. */
export const CONTROLLER_STOPPED = 'controller-stopped';

/** One periodic unit of work. */
export interface ControlLoop {
  /** Stable identifier; appears in logs and keys the controller's per-loop state. */
  readonly name: string;
  /** Gap between passes. Each loop chooses its own. */
  readonly intervalMs: number;
  /**
   * One pass. May throw — the controller logs it and keeps ticking, so a pass must
   * leave nothing half-applied that a later pass cannot recover from.
   */
  tick(signal: AbortSignal): Promise<void>;
}

interface LoopState {
  timer: NodeJS.Timeout | undefined;
  /** In-flight pass, if any. Also the re-entrancy guard. */
  pass: Promise<void> | undefined;
}

export class Controller {
  readonly #loops: readonly ControlLoop[];
  readonly #logger: Logger;
  readonly #state = new Map<string, LoopState>();
  readonly #abortController = new AbortController();

  constructor(params: { loops: readonly ControlLoop[]; logger: Logger }) {
    const names = new Set<string>();
    for (const loop of params.loops) {
      if (names.has(loop.name)) {
        throw new Error(`Duplicate control loop name: ${loop.name}`);
      }
      names.add(loop.name);
    }
    this.#loops = params.loops;
    this.#logger = params.logger;
  }

  /** Shared abort signal; aborted by {@link stop}. */
  get signal(): AbortSignal {
    return this.#abortController.signal;
  }

  /**
   * Starts every loop, each with an immediate first pass so a restart does not leave
   * work waiting a full interval.
   */
  start(): void {
    if (this.#abortController.signal.aborted || this.#state.size > 0) {
      return;
    }
    for (const loop of this.#loops) {
      const state: LoopState = { timer: undefined, pass: undefined };
      this.#state.set(loop.name, state);
      state.timer = setInterval(() => {
        void this.#tick(loop);
      }, loop.intervalMs);
      void this.#tick(loop);
    }
    this.#logger.info('Controller started', { loops: this.#loops.map(loop => loop.name) });
  }

  /**
   * Stops every loop: clears timers, aborts the shared signal, then waits for
   * in-flight passes to finish. Idempotent.
   */
  async stop(): Promise<void> {
    if (this.#abortController.signal.aborted) {
      return;
    }
    this.#abortController.abort(CONTROLLER_STOPPED);
    const passes: Promise<void>[] = [];
    for (const state of this.#state.values()) {
      if (state.timer) {
        clearInterval(state.timer);
        state.timer = undefined;
      }
      if (state.pass) {
        passes.push(state.pass);
      }
    }
    await Promise.all(passes);
    this.#logger.info('Controller stopped');
  }

  /**
   * One pass of one loop: never throws, never overlaps itself.
   *
   * A pass that outlives its interval skips the next tick rather than running twice.
   * Whatever it did not finish is picked up by the following pass — the same path a
   * restart takes.
   */
  async #tick(loop: ControlLoop): Promise<void> {
    const state = this.#state.get(loop.name);
    const { signal } = this.#abortController;
    // `state` is always set before the first #tick for that loop; guard is for types.
    if (!state || signal.aborted || state.pass) {
      return;
    }

    const pass = (async () => {
      try {
        await loop.tick(signal);
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        this.#logger.error('Control loop pass failed', { loop: loop.name, error });
      }
    })();

    state.pass = pass;
    try {
      await pass;
    } finally {
      state.pass = undefined;
    }
  }
}
