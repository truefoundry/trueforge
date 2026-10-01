import type { Logger } from 'winston';
import { extractErrorLogFields } from './errorLogFields';

export class PromiseTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromiseTimeoutError';
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, label?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new PromiseTimeoutError(
          label ? `Timed out after ${String(ms)}ms (${label})` : `Timed out after ${String(ms)}ms`,
        ),
      );
    }, ms);
  });

  return Promise.race([p, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * A latching, single-slot wake signal for a park/resume loop (one waiter at a time).
 *
 * `notify()` wakes a parked `wait()`, or — if no one is parked — latches so the *next*
 * `wait()` returns immediately. This avoids the lost-wakeup race where a `notify()` that
 * lands between "nothing to do" and `await wait()` would otherwise be dropped and the
 * loop would park forever. The latch is consumed by the `wait()` it releases.
 */
export interface Signalable {
  /** Wake the current waiter, or latch for the next wait() if none is parked. */
  notify(): void;
  /** Park until the next notify(); returns immediately if a notify() is already latched. */
  wait(): Promise<void>;
}

export function signalable(): Signalable {
  let latched = false;
  let resolveParked: (() => void) | undefined;
  return {
    notify(): void {
      if (resolveParked) {
        const resolve = resolveParked;
        resolveParked = undefined;
        resolve();
        return;
      }
      latched = true;
    },
    wait(): Promise<void> {
      if (latched) {
        latched = false;
        return Promise.resolve();
      }
      return new Promise<void>(resolve => {
        resolveParked = resolve;
      });
    },
  };
}

export async function* mergeAsyncGenerators<T>(
  generators: AsyncGenerator<T>[],
  logger: Logger,
): AsyncGenerator<T, void, unknown> {
  interface PendingResult {
    idx: number;
    result: IteratorResult<T, void>;
  }
  const pending = new Map<number, Promise<PendingResult>>();

  const getNextIteration = (idx: number): Promise<PendingResult> => {
    const generator = generators[idx];
    if (generator === undefined) {
      throw new Error(`Unreachable: missing generator at index ${String(idx)}`);
    }
    const nextPromise = generator.next().then(result => ({ idx, result }));
    nextPromise.catch((error: unknown) => {
      logger.error(`Unexpected error in mergeAsyncGenerators generator ${String(idx)}`, extractErrorLogFields(error));
    });
    return nextPromise;
  };

  for (let i = 0; i < generators.length; i++) {
    pending.set(i, getNextIteration(i));
  }

  while (pending.size > 0) {
    const { idx, result } = await Promise.race(pending.values());
    if (result.done) {
      pending.delete(idx);
      continue;
    }

    yield result.value;
    pending.set(idx, getNextIteration(idx));
  }
}
