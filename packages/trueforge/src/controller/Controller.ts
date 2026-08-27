/**
 * The controller: a set of periodic control loops and the timers that drive them.
 *
 * Loops are independent — each has its own interval, its own re-entrancy guard, and
 * its own error boundary, so a slow or failing loop cannot stall another. Adding
 * work to the controller means adding a {@link ControlLoop}, not touching this file.
 *
 * Today there is one loop: schedule dispatch. Reconciling stuck runs and re-arming
 * schedules that lost their pending row are the obvious next ones.
 *
 * The controller runs in exactly ONE process per database. In standalone mode that is
 * the server itself; when `STANDALONE=false` it is the dedicated single-replica
 * process in `src/controller.ts`. Loops are written assuming no peer runs alongside
 * them — see the concurrency note in `scheduleDispatch.ts`.
 */
import type { Logger } from 'winston';

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
  tick(): Promise<void>;
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
  #stopped = false;

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

  /**
   * Starts every loop, each with an immediate first pass so a restart does not leave
   * work waiting a full interval.
   *
   * Intervals are deliberately not `unref`'d: in the dedicated process they are what
   * keep the event loop alive.
   */
  start(): void {
    if (this.#stopped || this.#state.size > 0) {
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

  /** Stops every loop and waits for in-flight passes to finish. Idempotent. */
  async stop(): Promise<void> {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    const passes: Promise<void>[] = [];
    for (const state of this.#state.values()) {
      if (state.timer !== undefined) {
        clearInterval(state.timer);
        state.timer = undefined;
      }
      if (state.pass !== undefined) {
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
    if (state === undefined || this.#stopped || state.pass !== undefined) {
      return;
    }

    const pass = (async () => {
      try {
        await loop.tick();
      } catch (error) {
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
