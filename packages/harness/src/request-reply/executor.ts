import { randomUUID } from 'node:crypto';
import type { RedisClientType } from 'redis';
import type { Logger } from 'winston';
import z from 'zod';
import { extractErrorLogFields } from '../core/util/errorLogFields';
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

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_REPLY_TTL_MS = 120_000;

function resolveRunExecutorOptions(options: Partial<RunExecutorOptions> | undefined): RunExecutorOptions {
  return {
    heartbeatIntervalMs: options?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    replyTtlMs: options?.replyTtlMs ?? DEFAULT_REPLY_TTL_MS,
  };
}

/** Observability hook for subscriber errors, failed SUBSCRIBEs, and malformed messages. */
export type RequestReplyErrorHandler = (err: Error, context: { executorId: string; channel: string }) => void;

/**
 * Serving side of the request-reply transport: parses and validates each
 * published message, dispatches it to the request handler, writes the
 * JSONReply to the request's reply key, and refreshes the heartbeat key while
 * subscribed.
 *
 * Connection lifecycle stays with the caller: both clients are supplied
 * connected and are never closed here. `subscriberClient` is the connection to
 * SUBSCRIBE on — a `duplicate()` for standalone Redis, or the shared client
 * for Sentinel — and must have a reconnect strategy so a failed connect
 * self-heals (the executor re-subscribes on every `ready`).
 */
export class RequestReplyExecutor {
  readonly executorId: string;
  /** `rr:req:<executorId>` — the channel this executor subscribes to. */
  readonly channel: string;
  private readonly redis: RedisClientType;
  private readonly subscriberClient: RedisClientType;
  private readonly logger: Logger;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTtlMs: number;
  private readonly replyTtlMs: number;
  private readonly heartbeatKey: string;
  private readonly requestHandler: RequestHandler;
  private readonly onError: RequestReplyErrorHandler | undefined;
  /** Stable reference so node-redis dedupes the listener across re-subscribes. */
  private readonly subscribeListener = (message: string): void => {
    this.onMessage(message);
  };

  private closed = false;
  private initialized = false;
  private runningRequests = new Map<string, Promise<void>>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor({
    executorId,
    redis,
    subscriberClient,
    requestHandler,
    onError,
    logger,
    options,
  }: {
    executorId: string;
    /** Connected command client, used only for SET (reply + heartbeat). Caller owns its lifecycle. */
    redis: RedisClientType;
    /** Connected client to SUBSCRIBE on (duplicate or Sentinel). Caller owns its lifecycle. */
    subscriberClient: RedisClientType;
    requestHandler: RequestHandler;
    onError?: RequestReplyErrorHandler | undefined;
    logger: Logger;
    options?: Partial<RunExecutorOptions> | undefined;
  }) {
    const { heartbeatIntervalMs, replyTtlMs } = resolveRunExecutorOptions(options);
    this.executorId = executorId;
    this.redis = redis;
    this.subscriberClient = subscriberClient;
    this.logger = logger;
    this.replyTtlMs = replyTtlMs;
    this.requestHandler = requestHandler;
    this.onError = onError;
    this.channel = requestChannel(executorId);
    this.heartbeatKey = heartbeatKey(executorId);
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.heartbeatTtlMs = Math.ceil(this.heartbeatIntervalMs * 1.5);
  }

  async init(): Promise<void> {
    if (this.closed || this.initialized) {
      return;
    }
    this.initialized = true;

    this.subscriberClient.on('error', (err: Error) => {
      this.logger.error('[RequestReplyExecutor] Subscriber error', {
        executorId: this.executorId,
        ...extractErrorLogFields(err),
      });
      this.onError?.(err, { executorId: this.executorId, channel: this.channel });
      this.stopHeartbeat();
    });
    this.subscriberClient.on('end', () => {
      this.logger.warn('[RequestReplyExecutor] Subscriber connection ended', { executorId: this.executorId });
      this.stopHeartbeat();
    });
    // ready fires on the first connect and every reconnect; re-subscribing is
    // safe because node-redis dedupes the stable listener.
    this.subscriberClient.on('ready', () => {
      void this.setupSubscriber();
    });

    // On stable connections we won't get another ready event — if the caller
    // already connected the client, subscribe now.
    if (this.subscriberClient.isReady) {
      await this.setupSubscriber();
    }
  }

  private async setupSubscriber(): Promise<void> {
    if (this.closed) {
      return;
    }
    try {
      await this.subscriberClient.subscribe(this.channel, this.subscribeListener);
      this.logger.info('[RequestReplyExecutor] Subscribed to request channel', { executorId: this.executorId });
      this.stopHeartbeat();
      this.startHeartbeat();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err), { cause: err });
      this.logger.error('[RequestReplyExecutor] Error subscribing to request channel', {
        executorId: this.executorId,
        ...extractErrorLogFields(error),
      });
      this.onError?.(error, { executorId: this.executorId, channel: this.channel });
      this.stopHeartbeat();
    }
  }

  private async beat(): Promise<void> {
    this.logger.debug('[RequestReplyExecutor] Beating heartbeat', { executorId: this.executorId });
    try {
      await this.redis.set(this.heartbeatKey, '1', { PX: this.heartbeatTtlMs });
    } catch (err) {
      this.logger.error('[RequestReplyExecutor] Heartbeat error', {
        executorId: this.executorId,
        ...extractErrorLogFields(err),
      });
    }
  }

  /** Heartbeat only while subscribed. Idempotent (restarts the timer). */
  private startHeartbeat(): void {
    if (this.closed) {
      return;
    }
    this.logger.info('[RequestReplyExecutor] Starting heartbeat', { executorId: this.executorId });
    this.stopHeartbeat();
    void this.beat();
    this.heartbeatTimer = setInterval(() => {
      void this.beat();
    }, this.heartbeatIntervalMs);
  }

  /** A stopped heartbeat makes callers fail fast with NoResponderError. */
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
    } catch (err) {
      // Drop the request, this should never happen
      this.logger.warn('[RequestReplyExecutor] Request message is not valid JSON', { executorId: this.executorId });
      this.onError?.(
        new Error(`Request message is not valid JSON for executorId: ${this.executorId}`, {
          cause: err,
        }),
        {
          executorId: this.executorId,
          channel: this.channel,
        },
      );
      return;
    }

    const parsedRequest = publishedRequestSchema.safeParse(raw);
    if (!parsedRequest.success) {
      // Drop the request, this should never happen
      const zodError = z.treeifyError(parsedRequest.error);
      this.logger.warn('[RequestReplyExecutor] Invalid request message shape', {
        executorId: this.executorId,
        zod: zodError,
      });
      this.onError?.(
        new Error(
          `Invalid request message shape for executorId: ${this.executorId}, error: ${JSON.stringify(zodError)}`,
          { cause: parsedRequest.error },
        ),
        { executorId: this.executorId, channel: this.channel },
      );
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
        executorId: this.executorId,
        replyKey,
        ...extractErrorLogFields(err),
      });
    }
  }

  /** One raw pub/sub payload. Never throws. */
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

  // This function should never throw!
  // Stops intake: unsubscribe from the channel and stop the heartbeat. Never
  // closes the clients — the caller owns their lifecycle.
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.logger.info('[RequestReplyExecutor] Closing', { executorId: this.executorId });
    this.closed = true;
    try {
      await this.subscriberClient.unsubscribe(this.channel);
    } catch {
      // ignore: connection may already be closed
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
