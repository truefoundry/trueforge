/**
 * Runs `factory` and caches its settled result in `cache` under `key`, for the life of the
 * process (or until the caller's own eviction, if any — this never clears a cache itself).
 * Concurrent calls for the same key before the first settles share one in-flight call (no
 * thundering herd). A rejected attempt is evicted so the next call for that key retries instead
 * of being stuck forever.
 */
export function memoizeByKey<Key, Value>(
  cache: Map<Key, Promise<Value>>,
  key: Key,
  factory: () => Promise<Value>,
): Promise<Value> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const attempt = factory();
  cache.set(key, attempt);
  // A cache slot only ever gets a second entry after this one is evicted, so there is no
  // stale-vs-fresh race to guard against here: unconditional eviction is always correct.
  attempt.catch(() => {
    cache.delete(key);
  });
  return attempt;
}
