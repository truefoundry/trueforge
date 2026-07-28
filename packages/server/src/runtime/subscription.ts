/**
 * Standalone-Redis Subscription: duplicates the primary client for a dedicated
 * subscriber, since a subscribed connection cannot issue normal commands.
 */
import type { Subscription } from '@truefoundry/utils/request-reply';
import type { RedisClientType } from 'redis';
import type { Logger } from 'winston';

export function standaloneSubscription({ redis, logger }: { redis: RedisClientType; logger: Logger }): Subscription {
  let subscriberRedisClient: RedisClientType | null = null;
  let channel: string | null = null;

  return {
    async subscribe({ channel: requestChannel, onMessage, onLive, onLost }) {
      if (subscriberRedisClient) {
        return;
      }
      channel = requestChannel;
      const subscriber = redis.duplicate();
      subscriberRedisClient = subscriber;

      subscriber.on('error', (err: Error) => {
        logger.error('[standaloneSubscription] Subscriber error', { channel, error: err.message });
        onLost();
      });
      subscriber.on('end', () => {
        logger.warn('[standaloneSubscription] Subscriber connection ended', { channel });
        onLost();
      });
      // Re-attempt the subscribe on every ready (connect + each reconnect) so a
      // failed SUBSCRIBE self-heals. Safe: node-redis dedupes the stable
      // onMessage listener via a Set.
      subscriber.on('ready', () => {
        subscriber
          .subscribe(requestChannel, onMessage)
          .then(() => {
            logger.info('[standaloneSubscription] Subscribed to request channel', { channel });
            onLive();
          })
          .catch((err: unknown) => {
            logger.error('[standaloneSubscription] Error subscribing to request channel', {
              channel,
              error: err instanceof Error ? err.message : String(err),
            });
            onLost();
          });
      });

      try {
        await subscriber.connect();
      } catch (err) {
        // Reset the guard and destroy the half-built duplicate so a retried
        // subscribe() starts fresh.
        subscriberRedisClient = null;
        try {
          subscriber.destroy();
        } catch {
          // ignore: the client may never have connected
        }
        throw err;
      }
    },

    // Releases only the duplicated subscriber, never the primary client.
    async close() {
      if (!subscriberRedisClient) {
        return;
      }
      try {
        if (channel) {
          await subscriberRedisClient.unsubscribe(channel);
        }
      } catch {
        // ignore: connection may already be closed
      }
      try {
        await subscriberRedisClient.close();
      } catch {
        // ignore
      }
      subscriberRedisClient = null;
    },
  };
}
