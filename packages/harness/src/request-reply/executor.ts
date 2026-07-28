import { randomUUID } from 'node:crypto';
import type { RedisClientType } from 'redis';
import type { Logger } from 'winston';
import { ReplyError } from './errors';
import type { JSONReply, RequestHandler } from './types';
import { publishedRequestSchema } from './types';
import { heartbeatKey, requestChannel } from './utils';

export interface RunExecutorOptions {
  /** How often to refresh the heartbeat key (ms). */
  heartbeatIntervalMs: number;
  /** TTL for the reply value so abandoned keys are reclaimed (ms). */
  replyTtlMs: number;
}

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
export const DEFAULT_REPLY_TTL_MS = 120_000;

function resolveRunExecutorOptions(options: Partial<RunExecutorOptions> | undefined): RunExecutorOptions {
  return {
    heartbeatIntervalMs: options?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    replyTtlMs: options?.replyTtlMs ?? DEFAULT_REPLY_TTL_MS,
  };
}

/**
 * Serves this process's request channel: subscribes to `rr:req:<executorId>`
 * on a duplicated connection (a subscribed connection cannot issue normal
 * commands), refreshes the heartbeat key while subscribed, dispatches
 * messages to the request handler and writes each JSONReply to the request's
 * reply key.
 *
 * Divergence from the gateway: the primary client is injected and must be
 * connected before `init()` (no `onReady` singleton), and there is no
 * Sentinel subscription mode. The host owns the primary client's lifecycle;
 * the executor owns only the duplicated subscriber (released via `drain()`).
 */
export class RequestReplyExecutor {
  readonly executorId: string;
  private readonly redis: RedisClientType;
  private readonly logger: Logger;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTtlMs: number;
  private readonly replyTtlMs: number;
  private readonly heartbeatKey: string;
  private readonly channel: string;
  private readonly requestHandler: RequestHandler;

  private closed = false;
  private subscriberRedisClient: RedisClientType | null = null;
  private runningRequests = new Map<string, Promise<void>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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
    const { heartbeatIntervalMs, replyTtlMs } = resolveRunExecutorOptions(options);
    this.executorId = executorId;
    this.redis = redis;
    this.logger = logger;
    this.replyTtlMs = replyTtlMs;
    this.requestHandler = requestHandler;
    this.channel = requestChannel(executorId);
    this.heartbeatKey = heartbeatKey(executorId);
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.heartbeatTtlMs = Math.ceil(this.heartbeatIntervalMs * 1.5);
  }

  /** Requires a connected primary client (the host connects before calling). */
  async init(): Promise<void> {
    await this.setupSubscriber();
  }

  private async beat(): Promise<void> {
    this.logger.debug('[RequestReplyExecutor] Beating heartbeat', { executorId: this.executorId });
    try {
      await this.redis.set(this.heartbeatKey, '1', { PX: this.heartbeatTtlMs });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error('[RequestReplyExecutor] Heartbeat error', { executorId: this.executorId, error });
    }
  }

  private startHeartbeat(): void {
    this.logger.info('[RequestReplyExecutor] Starting heartbeat', { executorId: this.executorId });
    this.stopHeartbeat();
    void this.beat();
    this.heartbeatTimer = setInterval(() => {
      void this.beat();
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      this.logger.info('[RequestReplyExecutor] Stopping heartbeat', { executorId: this.executorId });
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async processRequestFromMessage(message: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      // Drop the request, this should never happen
      this.logger.warn('[RequestReplyExecutor] Request message is not valid JSON', { executorId: this.executorId });
      return;
    }

    const parsedRequest = publishedRequestSchema.safeParse(raw);
    if (!parsedRequest.success) {
      // Drop the request, this should never happen
      this.logger.warn('[RequestReplyExecutor] Invalid request message shape', {
        executorId: this.executorId,
        zod: parsedRequest.error.flatten(),
      });
      return;
    }

    const { replyKey, path, body, headers } = parsedRequest.data;
    let replyPayload: JSONReply;
    try {
      replyPayload = await this.requestHandler(path, { body, headers });
    } catch (err) {
      // Gateway maps hono's HTTPException here; ReplyError is the framework-neutral equivalent.
      if (err instanceof ReplyError) {
        replyPayload = { status: err.status, headers: {}, body: { message: err.message } };
      } else {
        const message = err instanceof Error ? err.message : String(err);
        replyPayload = { status: 500, headers: {}, body: { message } };
      }
    }

    try {
      await this.redis.set(replyKey, JSON.stringify(replyPayload), { PX: this.replyTtlMs });
    } catch (err) {
      this.logger.error('[RequestReplyExecutor] Request processing failed', {
        error: err instanceof Error ? err.message : String(err),
        executorId: this.executorId,
        replyKey,
      });
    }
  }

  private onMessage(message: string): void {
    this.logger.debug('[RequestReplyExecutor] Received message', { executorId: this.executorId, message });
    if (!message) {
      return;
    }
    if (this.closed) {
      this.logger.warn('[RequestReplyExecutor] Received message after executor is closed', {
        executorId: this.executorId,
        message,
      });
      return;
    }
    const pid = randomUUID();
    const requestPromise = this.processRequestFromMessage(message).finally(() => {
      this.runningRequests.delete(pid);
    });
    this.runningRequests.set(pid, requestPromise);
  }

  private async setupSubscriber(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.subscriberRedisClient) {
      return;
    }
    const subscriber = this.redis.duplicate();
    this.subscriberRedisClient = subscriber;

    // Heartbeat is gated on the subscription being live: a broken subscriber
    // stops the beat so callers fail fast with NoResponderError instead of
    // publishing into the void and timing out.
    subscriber.on('error', (err: Error) => {
      this.logger.error('[RequestReplyExecutor] Subscription client error', {
        executorId: this.executorId,
        error: err.message,
      });
      this.stopHeartbeat();
    });

    subscriber.on('ready', () => {
      if (this.closed) {
        return;
      }
      subscriber
        .subscribe(this.channel, (message: string) => {
          this.onMessage(message);
        })
        .then(() => {
          this.logger.info('[RequestReplyExecutor] Subscribed to request channel', { executorId: this.executorId });
          this.stopHeartbeat();
          this.startHeartbeat();
        })
        .catch((err: unknown) => {
          this.logger.error('[RequestReplyExecutor] Error subscribing to request channel', {
            executorId: this.executorId,
            error: err instanceof Error ? err.message : String(err),
          });
          this.stopHeartbeat();
        });
    });

    subscriber.on('end', () => {
      this.logger.warn('[RequestReplyExecutor] Subscription client ended', { executorId: this.executorId });
      this.stopHeartbeat();
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
  // Internal shutdown phase 1 (stop intake); drain() is the public entry.
  private async close(): Promise<void> {
    this.logger.info('[RequestReplyExecutor] Closing', { executorId: this.executorId });
    if (this.closed) {
      return;
    }
    this.closed = true;

    if (!this.subscriberRedisClient) {
      this.stopHeartbeat();
      return;
    }

    try {
      await this.subscriberRedisClient.unsubscribe(this.channel);
    } catch {
      // ignore: connection may already be closed
    }
    try {
      await this.subscriberRedisClient.close();
    } catch {
      // ignore
    }
    this.stopHeartbeat();
  }

  // This function should never throw!
  // This is called during graceful shutdown
  async drain(): Promise<void> {
    await this.close();
    await Promise.allSettled(Array.from(this.runningRequests.values()));
  }
}
