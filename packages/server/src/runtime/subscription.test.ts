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
  it('a failed attach resolves, retries on primary ready, and close() detaches the retry', async () => {
    const logger = winston.createLogger({ silent: true });
    const redis = deadRedisClient();
    const subscription = standaloneSubscription({ redis, logger });
    let liveSignals = 0;
    const hooks = {
      channel: 'rr:req:test-exec',
      onMessage: () => undefined,
      onLive: () => {
        liveSignals += 1;
      },
      onLost: () => undefined,
    };

    // A failed connect is swallowed, not surfaced to init().
    await subscription.subscribe(hooks);
    assert.equal(liveSignals, 0);
    assert.equal(redis.listenerCount('ready'), 1);

    // A primary 'ready' re-attempts the attach; it fails again here but must
    // neither throw nor leave a half-built subscriber behind.
    redis.emit('ready');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(liveSignals, 0);

    await subscription.close();
    assert.equal(redis.listenerCount('ready'), 0);
  });
});
