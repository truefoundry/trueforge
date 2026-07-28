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
 * Strategy-free serving core of the request-reply transport: parses and
 * validates each published message, dispatches it to the request handler,
 * writes the JSONReply to the request's reply key, and refreshes the
 * heartbeat key while serving. It never subscribes — how a process attaches
 * to `channel` (standalone duplicate, Sentinel shared client, ...) is the
 * caller's business. `RequestReplyExecutor` is the standalone reference
 * wrapper and the model for custom ones.
 *
 * Calling-order contract: attach the subscription first, then
 * `startServing()`. Starting the heartbeat before the subscription is live
 * advertises a responder that is not listening, so callers time out instead
 * of failing fast with NoResponderError.
 */
export class RequestReplyServingCore {
  readonly executorId: string;
  /** `rr:req:<executorId>` — the channel wrappers must subscribe to. */
  readonly channel: string;
  private readonly redis: RedisClientType;
  private readonly logger: Logger;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTtlMs: number;
  private readonly replyTtlMs: number;
  private readonly heartbeatKey: string;
  private readonly requestHandler: RequestHandler;

  private closed = false;
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
    /** Connected command client, used only for SET (reply + heartbeat). Host owns its lifecycle. */
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

  private async beat(): Promise<void> {
    this.logger.debug('[RequestReplyServingCore] Beating heartbeat', { executorId: this.executorId });
    try {
      await this.redis.set(this.heartbeatKey, '1', { PX: this.heartbeatTtlMs });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error('[RequestReplyServingCore] Heartbeat error', { executorId: this.executorId, error });
    }
  }

  /**
   * Heartbeat is gated on the subscription being live: wrappers call this
   * once their subscribe succeeds. Idempotent (restarts the timer).
   */
  startServing(): void {
    if (this.closed) {
      return;
    }
    this.logger.info('[RequestReplyServingCore] Starting heartbeat', { executorId: this.executorId });
    this.stopServing();
    void this.beat();
    this.heartbeatTimer = setInterval(() => {
      void this.beat();
    }, this.heartbeatIntervalMs);
  }

  /**
   * Wrappers call this when the subscription breaks (subscriber error/end):
   * a stopped heartbeat makes callers fail fast with NoResponderError instead
   * of publishing into the void and timing out.
   */
  stopServing(): void {
    if (this.heartbeatTimer) {
      this.logger.info('[RequestReplyServingCore] Stopping heartbeat', { executorId: this.executorId });
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
      this.logger.warn('[RequestReplyServingCore] Request message is not valid JSON', { executorId: this.executorId });
      return;
    }

    const parsedRequest = publishedRequestSchema.safeParse(raw);
    if (!parsedRequest.success) {
      // Drop the request, this should never happen
      this.logger.warn('[RequestReplyServingCore] Invalid request message shape', {
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
      this.logger.error('[RequestReplyServingCore] Request processing failed', {
        error: err instanceof Error ? err.message : String(err),
        executorId: this.executorId,
        replyKey,
      });
    }
  }

  /** Feed one raw pub/sub payload from the wrapper's subscription. Never throws. */
  handleMessage(message: string): void {
    this.logger.debug('[RequestReplyServingCore] Received message', { executorId: this.executorId, message });
    if (!message) {
      return;
    }
    if (this.closed) {
      this.logger.warn('[RequestReplyServingCore] Received message after core is closed', {
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
  // Wrappers release their subscription first, then delegate here.
  async drain(): Promise<void> {
    this.logger.info('[RequestReplyServingCore] Draining', { executorId: this.executorId });
    this.closed = true;
    this.stopServing();
    await Promise.allSettled(Array.from(this.runningRequests.values()));
  }
}
