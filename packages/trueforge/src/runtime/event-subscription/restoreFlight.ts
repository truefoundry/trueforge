/**
 * One rebuild of a missing turn stream reads the whole durable log.
 * Same-process callers share that work. Redis callers also take a per-stream
 * lease and a shared slot so other replicas do not read the log at the same time.
 */
import { redisKey } from '@truefoundry/trueforge-core/core/redisKeys';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { RestoreLogOutcome } from './restore';

/** How many missing streams may read the durable log at once. */
const RESTORE_CONCURRENCY = 2;
/** Covers a slow page read. The holder extends it while it still owns the lease. */
const RESTORE_LEASE_SECONDS = 60;
const RESTORE_WAIT_MS = 30_000;
const RESTORE_POLL_MS = 50;

const RESTORE_BUDGET_KEY = redisKey('agent', 'turn', 'stream-restore-slots');

const inflight = new Map<string, Promise<RestoreLogOutcome>>();

/** Join an in-process restore of the same stream instead of starting another. */
export function shareRestore(flightKey: string, run: () => Promise<RestoreLogOutcome>): Promise<RestoreLogOutcome> {
  const existing = inflight.get(flightKey);
  if (existing !== undefined) {
    return existing;
  }
  const flight = run().finally(() => {
    if (inflight.get(flightKey) === flight) {
      inflight.delete(flightKey);
    }
  });
  inflight.set(flightKey, flight);
  return flight;
}

let activeRestores = 0;
const budgetWaiters: (() => void)[] = [];

/** Process-local cap used when there is no Redis to share a slot across replicas. */
export function withLocalRestoreBudget<T>(run: () => Promise<T>): Promise<T> {
  const acquired = new Promise<void>(resolve => {
    if (activeRestores < RESTORE_CONCURRENCY) {
      activeRestores += 1;
      resolve();
      return;
    }
    budgetWaiters.push(() => {
      activeRestores += 1;
      resolve();
    });
  });
  return acquired.then(async () => {
    try {
      return await run();
    } finally {
      activeRestores -= 1;
      budgetWaiters.shift()?.();
    }
  });
}

/** The two Redis commands the lease and the shared slot need. */
export interface RestoreLeaseClient {
  set(key: string, value: string, options: { NX: true; EX: number }): Promise<unknown>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

const ACQUIRE_BUDGET = `
local n = redis.call('INCR', KEYS[1])
if n > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`;

const RELEASE_BUDGET = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
local n = redis.call('DECR', KEYS[1])
if n <= 0 then
  redis.call('DEL', KEYS[1])
end
return 1
`;

const EXTEND_BUDGET = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
return redis.call('EXPIRE', KEYS[1], ARGV[1])
`;

const RELEASE_OR_EXTEND_LEASE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
if ARGV[3] == 'del' then
  return redis.call('DEL', KEYS[1])
end
return redis.call('EXPIRE', KEYS[1], ARGV[2])
`;

async function acquireRedisBudget(redis: RestoreLeaseClient, deadlineMs: number): Promise<boolean> {
  for (;;) {
    const granted = await redis.eval(ACQUIRE_BUDGET, {
      keys: [RESTORE_BUDGET_KEY],
      arguments: [String(RESTORE_CONCURRENCY), String(RESTORE_LEASE_SECONDS)],
    });
    if (granted === 1) {
      return true;
    }
    if (Date.now() >= deadlineMs) {
      return false;
    }
    await sleep(RESTORE_POLL_MS);
  }
}

async function releaseRedisBudget(redis: RestoreLeaseClient): Promise<void> {
  await redis.eval(RELEASE_BUDGET, { keys: [RESTORE_BUDGET_KEY], arguments: [] });
}

/** Keeps the shared counter alive so a long rebuild does not lose its slot mid-read. */
async function extendRedisBudget(redis: RestoreLeaseClient): Promise<void> {
  await redis.eval(EXTEND_BUDGET, { keys: [RESTORE_BUDGET_KEY], arguments: [String(RESTORE_LEASE_SECONDS)] });
}

function leaseKey(streamId: string): string {
  return `${streamId}:restore-lock`;
}

async function releaseOrExtendLease(input: {
  redis: RestoreLeaseClient;
  key: string;
  token: string;
  action: 'del' | 'expire';
}): Promise<void> {
  await input.redis.eval(RELEASE_OR_EXTEND_LEASE, {
    keys: [input.key],
    arguments: [input.token, String(RESTORE_LEASE_SECONDS), input.action],
  });
}

/**
 * Run `run` only when this caller holds the stream lease and a shared restore slot.
 * A stream that appears while waiting is left in place. `extendLease` keeps the
 * lease and the shared slot counter alive across durable-log pages.
 */
export async function withRedisRestoreTurn(input: {
  redis: RestoreLeaseClient;
  streamId: string;
  readTailEntryId: () => Promise<string | undefined>;
  refreshTtl: () => Promise<void>;
  run: (extendLease: () => Promise<void>) => Promise<RestoreLogOutcome>;
}): Promise<RestoreLogOutcome> {
  if ((await input.readTailEntryId()) !== undefined) {
    await input.refreshTtl();
    return 'present';
  }

  const deadlineMs = Date.now() + RESTORE_WAIT_MS;
  const token = randomUUID();
  const key = leaseKey(input.streamId);
  for (;;) {
    if ((await input.readTailEntryId()) !== undefined) {
      await input.refreshTtl();
      return 'present';
    }
    const claimed = await input.redis.set(key, token, { NX: true, EX: RESTORE_LEASE_SECONDS });
    if (claimed === 'OK') {
      break;
    }
    if (Date.now() >= deadlineMs) {
      throw new Error(`Turn stream restore is busy: ${input.streamId}`);
    }
    await sleep(RESTORE_POLL_MS);
  }

  let budgetHeld = false;
  try {
    budgetHeld = await acquireRedisBudget(input.redis, deadlineMs);
    if (!budgetHeld) {
      throw new Error(`Turn stream restore is busy: ${input.streamId}`);
    }
    if ((await input.readTailEntryId()) !== undefined) {
      await input.refreshTtl();
      return 'present';
    }
    return await input.run(async () => {
      await releaseOrExtendLease({ redis: input.redis, key, token, action: 'expire' });
      await extendRedisBudget(input.redis);
    });
  } finally {
    if (budgetHeld) {
      await releaseRedisBudget(input.redis);
    }
    await releaseOrExtendLease({ redis: input.redis, key, token, action: 'del' });
  }
}

/** Refresh the lease before each page so a long read does not expire the lock mid-install. */
export async function* pagesExtendingLease<T>(
  pages: AsyncIterable<readonly T[]>,
  extendLease: () => Promise<void>,
): AsyncGenerator<readonly T[]> {
  await extendLease();
  for await (const page of pages) {
    yield page;
    await extendLease();
  }
}
