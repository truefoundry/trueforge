import { randomUUID } from 'node:crypto';
import type { RedisClientType } from 'redis';
import type { Logger } from 'winston';
import { ReplyError } from './errors';
import type { Subscription } from './subscription';
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
 * Serving side of the request-reply transport: parses and validates each
 * published message, dispatches it to the request handler, writes the
 * JSONReply to the request's reply key, and refreshes the heartbeat key while
 * the subscription is live.
 *
 * Connection management stays with the host: the executor never subscribes
 * itself — `init()` attaches the injected `Subscription` and reacts to its
 * onLive/onLost signals; `drain()` releases it before waiting out in-flight
 * requests. The injected `redis` command client is used only for SETs
 * (replies + heartbeat) and its lifecycle is host-owned too.
 */
export class RequestReplyExecutor {
  readonly executorId: string;
  /** `rr:req:<executorId>` — the channel the subscription attaches to. */
  readonly channel: string;
  private readonly redis: RedisClientType;
  private readonly logger: Logger;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTtlMs: number;
  private readonly replyTtlMs: number;
  private readonly heartbeatKey: string;
  private readonly requestHandler: RequestHandler;
  private readonly subscription: Subscription;

  private closed = false;
  private subscribed = false;
  private runningRequests = new Map<string, Promise<void>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor({
    executorId,
    redis,
    requestHandler,
    subscription,
    logger,
    options,
  }: {
    executorId: string;
    /** Connected command client, used only for SET (reply + heartbeat). Host owns its lifecycle. */
    redis: RedisClientType;
    requestHandler: RequestHandler;
    /** Host-owned channel attach/detach strategy (see subscription.ts). */
    subscription: Subscription;
    logger: Logger;
    options?: Partial<RunExecutorOptions> | undefined;
  }) {
    const { heartbeatIntervalMs, replyTtlMs } = resolveRunExecutorOptions(options);
    this.executorId = executorId;
    this.redis = redis;
    this.logger = logger;
    this.replyTtlMs = replyTtlMs;
    this.requestHandler = requestHandler;
    this.subscription = subscription;
    this.channel = requestChannel(executorId);
    this.heartbeatKey = heartbeatKey(executorId);
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.heartbeatTtlMs = Math.ceil(this.heartbeatIntervalMs * 1.5);
  }

  /**
   * Attaches the subscription. A rejected `subscribe` is logged and leaves
   * the executor unsubscribed (heartbeat off), so `init()` may be retried.
   */
  async init(): Promise<void> {
    if (this.closed || this.subscribed) {
      return;
    }
    this.subscribed = true;
    try {
      await this.subscription.subscribe({
        channel: this.channel,
        onMessage: message => {
          this.handleMessage(message);
        },
        onLive: () => {
          this.startServing();
        },
        onLost: () => {
          this.stopServing();
        },
      });
    } catch (err) {
      this.subscribed = false;
      this.logger.error('[RequestReplyExecutor] Error attaching subscription', {
        executorId: this.executorId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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

  /** onLive: heartbeat only while the subscription is live. Idempotent (restarts the timer). */
  private startServing(): void {
    if (this.closed) {
      return;
    }
    this.logger.info('[RequestReplyExecutor] Starting heartbeat', { executorId: this.executorId });
    this.stopServing();
    void this.beat();
    this.heartbeatTimer = setInterval(() => {
      void this.beat();
    }, this.heartbeatIntervalMs);
  }

  /** onLost: a stopped heartbeat makes callers fail fast with NoResponderError. */
  private stopServing(): void {
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
      // ReplyError lets handlers choose the reply status; any other throw is an unexpected 500.
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

  /** onMessage: one raw pub/sub payload from the subscription. Never throws. */
  private handleMessage(message: string): void {
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

  // This function should never throw!
  // Shutdown entry: release the subscription (stop intake), then stop the
  // heartbeat and wait out in-flight replies.
  async drain(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.logger.info('[RequestReplyExecutor] Draining', { executorId: this.executorId });
    try {
      // Subscriptions must not throw from close(); guard anyway because a
      // broken host implementation must not abort process shutdown.
      await this.subscription.close();
    } catch (err) {
      this.logger.error('[RequestReplyExecutor] Error closing subscription', {
        executorId: this.executorId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.closed = true;
    this.stopServing();
    await Promise.allSettled(Array.from(this.runningRequests.values()));
  }
}
