import { memoizeByKey } from '../../../../../src/sandbox/kubernetes/core/memoizeByKey';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  const box: { resolve?: (value: T) => void; reject?: (error: unknown) => void } = {};
  const promise = new Promise<T>((res, rej) => {
    box.resolve = res;
    box.reject = rej;
  });
  // The Promise executor above runs synchronously, so both are set by this point.
  if (box.resolve === undefined || box.reject === undefined) {
    throw new Error('unreachable: Promise executor did not run synchronously');
  }
  return { promise, resolve: box.resolve, reject: box.reject };
}

describe('memoizeByKey', () => {
  it('calls the factory once per distinct key', async () => {
    const cache = new Map<string, Promise<string>>();
    const factory = jest.fn(() => Promise.resolve('value'));

    await memoizeByKey(cache, 'a', factory);
    await memoizeByKey(cache, 'a', factory);

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('returns the same settled value for repeated calls with the same key', async () => {
    const cache = new Map<string, Promise<{ key: string }>>();
    const factory = jest.fn(() => Promise.resolve({ key: 'a' }));

    const first = await memoizeByKey(cache, 'a', factory);
    const second = await memoizeByKey(cache, 'a', factory);

    expect(second).toBe(first);
  });

  it('calls the factory again for a different key', async () => {
    const cache = new Map<string, Promise<string>>();
    const factoryA = jest.fn(() => Promise.resolve('value-a'));
    const factoryB = jest.fn(() => Promise.resolve('value-b'));

    await memoizeByKey(cache, 'a', factoryA);
    await memoizeByKey(cache, 'b', factoryB);

    expect(factoryA).toHaveBeenCalledTimes(1);
    expect(factoryB).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent calls for the same key into a single in-flight factory invocation', async () => {
    const cache = new Map<string, Promise<string>>();
    const gate = deferred<string>();
    const factory = jest.fn(() => gate.promise);

    const first = memoizeByKey(cache, 'a', factory);
    const second = memoizeByKey(cache, 'a', factory);
    gate.resolve('resolved');
    await expect(first).resolves.toBe('resolved');
    await expect(second).resolves.toBe('resolved');

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('evicts a rejected attempt so the next call for that key retries', async () => {
    const cache = new Map<string, Promise<string>>();
    const factory = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('cluster unreachable'))
      .mockResolvedValueOnce('recovered');

    await expect(memoizeByKey(cache, 'a', factory)).rejects.toThrow('cluster unreachable');
    await expect(memoizeByKey(cache, 'a', factory)).resolves.toBe('recovered');

    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('does not evict a fulfilled attempt — success stays cached', async () => {
    const cache = new Map<string, Promise<string>>();
    const factory = jest.fn(() => Promise.resolve('value'));

    await memoizeByKey(cache, 'a', factory);
    // Let any eviction microtasks (there should be none) settle before checking again.
    await Promise.resolve();
    await memoizeByKey(cache, 'a', factory);

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('caches a retry that succeeds after an earlier rejection, and stops retrying once fulfilled', async () => {
    const cache = new Map<string, Promise<string>>();
    const slow = deferred<string>();
    const factory = jest.fn<Promise<string>, []>().mockReturnValueOnce(slow.promise);

    const firstAttempt = memoizeByKey(cache, 'a', factory);
    slow.reject(new Error('cluster unreachable'));
    await expect(firstAttempt).rejects.toThrow('cluster unreachable');

    factory.mockResolvedValueOnce('recovered');
    await expect(memoizeByKey(cache, 'a', factory)).resolves.toBe('recovered');
    // A third call must reuse the now-fulfilled retry, not attempt a third factory call.
    await expect(memoizeByKey(cache, 'a', factory)).resolves.toBe('recovered');

    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('lets each per-call factory close over its own context, keyed independently of that context', async () => {
    const cache = new Map<string, Promise<string>>();

    const forTenantAcme = await memoizeByKey(cache, 'acme', () => Promise.resolve('acme-provider'));
    const forTenantOther = await memoizeByKey(cache, 'other', () => Promise.resolve('other-provider'));
    // A later call for 'acme' with a *different* closure still returns the cached first result —
    // this is the exact shape the real caller relies on (per-call options captured by closure).
    const forTenantAcmeAgain = await memoizeByKey(cache, 'acme', () => Promise.resolve('should-not-run'));

    expect(forTenantAcme).toBe('acme-provider');
    expect(forTenantOther).toBe('other-provider');
    expect(forTenantAcmeAgain).toBe('acme-provider');
  });
});
