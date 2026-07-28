import type { RedisClientType } from 'redis';
import type { Logger } from 'winston';
import type { RunExecutorOptions } from './servingCore';
import { RequestReplyServingCore } from './servingCore';
import type { RequestHandler } from './types';

/**
 * Standalone-subscribe wrapper over `RequestReplyServingCore`: duplicates the
 * injected primary client (a subscribed connection cannot issue normal
 * commands), subscribes to the core's channel and gates the heartbeat on the
 * subscription being live. All wire semantics live in the core; this class
 * owns only the duplicated subscriber (released via `drain()`).
 *
 * Divergence from the gateway: the primary client is injected and must be
 * connected before `init()` (no `onReady` singleton), and there is no
 * Sentinel subscription mode — hosts with other topologies write their own
 * wrapper over `RequestReplyServingCore`.
 */
export class RequestReplyExecutor {
  readonly executorId: string;
  private readonly core: RequestReplyServingCore;
  private readonly redis: RedisClientType;
  private readonly logger: Logger;

  private closed = false;
  private subscriberRedisClient: RedisClientType | null = null;

  constructor({
    executorId,
    redis,
    requestHandler,
    logger,
    options,
  }: {
    executorId: string;
    redis: RedisClientType;
    requestHandler: RequestHandler;
    logger: Logger;
    options?: Partial<RunExecutorOptions> | undefined;
  }) {
    this.executorId = executorId;
    this.redis = redis;
    this.logger = logger;
    this.core = new RequestReplyServingCore({ executorId, redis, requestHandler, logger, options });
  }

  /** Requires a connected primary client (the host connects before calling). */
  async init(): Promise<void> {
    if (this.closed || this.subscriberRedisClient) {
      return;
    }
    const subscriber = this.redis.duplicate();
    this.subscriberRedisClient = subscriber;

    subscriber.on('error', (err: Error) => {
      this.logger.error('[RequestReplyExecutor] Subscription client error', {
        executorId: this.executorId,
        error: err.message,
      });
      this.core.stopServing();
    });

    subscriber.on('ready', () => {
      if (this.closed) {
        return;
      }
      subscriber
        .subscribe(this.core.channel, (message: string) => {
          this.core.handleMessage(message);
        })
        .then(() => {
          this.logger.info('[RequestReplyExecutor] Subscribed to request channel', { executorId: this.executorId });
          this.core.startServing();
        })
        .catch((err: unknown) => {
          this.logger.error('[RequestReplyExecutor] Error subscribing to request channel', {
            executorId: this.executorId,
            error: err instanceof Error ? err.message : String(err),
          });
          this.core.stopServing();
        });
    });

    subscriber.on('end', () => {
      this.logger.warn('[RequestReplyExecutor] Subscription client ended', { executorId: this.executorId });
      this.core.stopServing();
    });

    try {
      await subscriber.connect();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error('[RequestReplyExecutor] Error connecting to subscription client', {
        executorId: this.executorId,
        error,
      });
      this.subscriberRedisClient = null;
    }
  }

  // This function should never throw!
  // Releases the duplicated subscriber so no new messages arrive.
  private async closeSubscriber(): Promise<void> {
    this.logger.info('[RequestReplyExecutor] Closing', { executorId: this.executorId });
    if (this.closed) {
      return;
    }
    this.closed = true;

    if (!this.subscriberRedisClient) {
      return;
    }
    try {
      await this.subscriberRedisClient.unsubscribe(this.core.channel);
    } catch {
      // ignore: connection may already be closed
    }
    try {
      await this.subscriberRedisClient.close();
    } catch {
      // ignore
    }
  }

  // This function should never throw!
  // This is called during graceful shutdown
  async drain(): Promise<void> {
    await this.closeSubscriber();
    await this.core.drain();
  }
}
