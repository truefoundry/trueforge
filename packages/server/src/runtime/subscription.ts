/**
 * Standalone-Redis Subscription for the request-reply executor: a subscribed
 * connection cannot issue normal commands, so duplicate the primary client
 * for a dedicated subscriber. Server-owned on purpose — the package only
 * defines the Subscription contract and never manages connections (hosts
 * with other topologies, e.g. Sentinel, implement their own).
 */
import type { Subscription } from '@truefoundry/utils/request-reply';
import type { RedisClientType } from 'redis';
import type { Logger } from 'winston';

export function standaloneSubscription({ redis, logger }: { redis: RedisClientType; logger: Logger }): Subscription {
  let subscriber: RedisClientType | null = null;
  let channel: string | null = null;

  return {
    async subscribe({ channel: requestChannel, onMessage, onLive, onLost }) {
      if (subscriber) {
        return;
      }
      channel = requestChannel;
      subscriber = redis.duplicate();
      let live = false;

      subscriber.on('error', (err: Error) => {
        logger.error('[standaloneSubscription] Subscriber error', { channel, error: err.message });
        onLost();
      });
      subscriber.on('end', () => {
        logger.warn('[standaloneSubscription] Subscriber connection ended', { channel });
        onLost();
      });
      // After a reconnect node-redis restores the subscription itself; only
      // the heartbeat needs restarting. The first ready (during connect())
      // precedes our subscribe, so it must not signal live yet.
      subscriber.on('ready', () => {
        if (live) {
          onLive();
        }
      });

      await subscriber.connect();
      await subscriber.subscribe(requestChannel, onMessage);
      live = true;
      onLive();
    },

    // Releases only the duplicated subscriber, never the primary client.
    async close() {
      if (!subscriber) {
        return;
      }
      try {
        if (channel) {
          await subscriber.unsubscribe(channel);
        }
      } catch {
        // ignore: connection may already be closed
      }
      try {
        await subscriber.close();
      } catch {
        // ignore
      }
      subscriber = null;
    },
  };
}
