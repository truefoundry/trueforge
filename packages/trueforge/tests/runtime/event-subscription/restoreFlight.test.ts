import { setTimeout as sleep } from 'node:timers/promises';
import {
  shareRestore,
  withLocalRestoreBudget,
  withRedisRestoreTurn,
  type RestoreLeaseClient,
} from '../../../src/runtime/event-subscription/restoreFlight';

class FakeRestoreRedis implements RestoreLeaseClient {
  private readonly values = new Map<string, string>();

  set(key: string, value: string, options: { NX: true; EX: number }): Promise<unknown> {
    if (options.NX && this.values.has(key)) {
      return Promise.resolve(null);
    }
    this.values.set(key, value);
    return Promise.resolve('OK');
  }

  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    const key = options.keys[0];
    if (key === undefined) {
      return Promise.resolve(0);
    }
    if (script.includes("redis.call('INCR'")) {
      const limit = Number(options.arguments[0]);
      const next = Number(this.values.get(key) ?? '0') + 1;
      if (next > limit) {
        return Promise.resolve(0);
      }
      this.values.set(key, String(next));
      return Promise.resolve(1);
    }
    if (script.includes("redis.call('DECR'")) {
      if (!this.values.has(key)) {
        return Promise.resolve(0);
      }
      const next = Number(this.values.get(key)) - 1;
      if (next <= 0) {
        this.values.delete(key);
      } else {
        this.values.set(key, String(next));
      }
      return Promise.resolve(1);
    }
    const token = options.arguments[0];
    if (this.values.get(key) !== token) {
      return Promise.resolve(0);
    }
    if (options.arguments[2] === 'del') {
      this.values.delete(key);
    }
    return Promise.resolve(1);
  }
}

describe('restore flight', () => {
  it('shares one in-process restore of the same stream', async () => {
    let runs = 0;
    const run = () =>
      shareRestore('flight:one', async () => {
        runs += 1;
        await sleep(20);
        return 'installed';
      });

    await expect(Promise.all([run(), run(), run()])).resolves.toEqual(['installed', 'installed', 'installed']);
    expect(runs).toBe(1);
  });

  it('runs at most two local rebuilds at once', async () => {
    let active = 0;
    let max = 0;
    const run = () =>
      withLocalRestoreBudget(async () => {
        active += 1;
        max = Math.max(max, active);
        await sleep(30);
        active -= 1;
      });

    await Promise.all([run(), run(), run()]);
    expect(max).toBe(2);
  });

  it('lets one replica read a missing stream while the other waits for it', async () => {
    const redis = new FakeRestoreRedis();
    let tail: string | undefined;
    let runs = 0;
    const run = () =>
      withRedisRestoreTurn({
        redis,
        streamId: 'stream-a',
        readTailEntryId: () => Promise.resolve(tail),
        refreshTtl: () => Promise.resolve(),
        run: async () => {
          runs += 1;
          await sleep(40);
          tail = '1-0';
          return 'installed';
        },
      });

    const results = await Promise.all([run(), run()]);
    expect(runs).toBe(1);
    expect([...results].sort()).toEqual(['installed', 'present']);
  });

  it('holds a third stream until a restore slot frees', async () => {
    const redis = new FakeRestoreRedis();
    let active = 0;
    let max = 0;
    let resolveGate = (): void => undefined;
    const gate = new Promise<void>(resolve => {
      resolveGate = resolve;
    });
    const one = (streamId: string) =>
      withRedisRestoreTurn({
        redis,
        streamId,
        readTailEntryId: () => Promise.resolve(undefined),
        refreshTtl: () => Promise.resolve(),
        run: async () => {
          active += 1;
          max = Math.max(max, active);
          await gate;
          active -= 1;
          return 'installed';
        },
      });

    const pending = Promise.all([one('stream-a'), one('stream-b'), one('stream-c')]);
    await sleep(150);
    expect(active).toBe(2);
    expect(max).toBe(2);
    resolveGate();
    await pending;
    expect(max).toBe(2);
  });
});
