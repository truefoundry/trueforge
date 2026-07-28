import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createClient, type RedisClientType } from 'redis';
import winston from 'winston';
import { standaloneSubscription } from './subscription';

/** Points at a closed port with reconnects disabled so connect() rejects immediately. */
function deadRedisClient(): RedisClientType {
  return createClient({
    url: 'redis://127.0.0.1:1',
    socket: { reconnectStrategy: false },
  });
}

describe('standaloneSubscription', () => {
  it('a failed attach resets the guard so a retry attaches instead of silently no-oping', async () => {
    const logger = winston.createLogger({ silent: true });
    const subscription = standaloneSubscription({ redis: deadRedisClient(), logger });
    let liveSignals = 0;
    const hooks = {
      channel: 'rr:req:test-exec',
      onMessage: () => undefined,
      onLive: () => {
        liveSignals += 1;
      },
      onLost: () => undefined,
    };

    await assert.rejects(subscription.subscribe(hooks));
    assert.equal(liveSignals, 0);

    // Before the guard reset, this second attempt resolved without attaching
    // or signalling onLive — the executor then believed it was subscribed and
    // never started its heartbeat. It must reject (a real retry) instead.
    await assert.rejects(subscription.subscribe(hooks));
    assert.equal(liveSignals, 0);

    await subscription.close();
  });
});
