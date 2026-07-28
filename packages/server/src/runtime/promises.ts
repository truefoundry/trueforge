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
