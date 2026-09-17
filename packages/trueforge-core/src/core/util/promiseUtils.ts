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

/** Runs `fn` over `items` with at most `concurrency` calls in flight. Results stay in input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const completed: { index: number; value: R }[] = [];
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      if (signal?.aborted) {
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      completed.push({ index, value: await fn(item, index) });
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  completed.sort((a, b) => a.index - b.index);
  return completed.map(entry => entry.value);
}
