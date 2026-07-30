import type { RedisClientType } from 'redis';
import { InMemoryEventStreamStore, InMemoryEventSubscription } from './inMemory';
import { RedisEventSubscription } from './redis';

export interface EventSubscriptionPutOptions {
  /** Sets the lifetime of the whole stream after this append. */
  streamTTLSeconds?: number | undefined;
}

export type SequencedEvent<T extends object> = T & { sequence_number: number };

/**
 * One turn's resumable event stream, obtained from {@link EventSubscriptionRegistry.get}.
 * Per-stream state (e.g. the sequence counter) lives on the instance and is freed with it.
 */
export interface EventSubscription<T extends object> {
  /** Appends an event, assigns its sequence number, and returns that number. */
  put(event: T, options?: EventSubscriptionPutOptions): Promise<number>;

  /** Yields events strictly after the supplied sequence, or from the start when omitted. */
  poll(afterSequenceNumber?: number): AsyncGenerator<SequencedEvent<T>, void, unknown>;
}

/**
 * Hands out stream-scoped {@link EventSubscription}s: Redis-backed when a
 * client is supplied, otherwise views over one shared in-process store.
 */
export class EventSubscriptionRegistry<T extends object> {
  /** One store for the whole process so producers and subscribers share streams. */
  private readonly memoryStore = new InMemoryEventStreamStore<T>();

  constructor(
    private readonly redis: RedisClientType | undefined,
    private readonly parseEvent: (raw: unknown) => T,
  ) {}

  get(streamId: string): EventSubscription<T> {
    if (this.redis) {
      return new RedisEventSubscription(this.redis, streamId, this.parseEvent);
    }
    return new InMemoryEventSubscription(this.memoryStore, streamId);
  }
}

/** Redis/in-memory key for one turn's resumable event stream. */
export function turnStreamId(tenantId: string, sessionId: string, turnId: string): string {
  return `agent:turn:${tenantId}:${sessionId}:${turnId}:stream`;
}

/** Reject new subscriptions when the stream expires within this window. */
export const SUBSCRIBE_STREAM_THRESHOLD_MS = 60 * 1_000;
/** Delay between poll iterations while a stream has no new events. */
export const SUBSCRIBE_STREAM_POLL_SLEEP_INTERVAL_MS = 1_000;

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** The stream expired or was never created (map to HTTP 412). */
export class StreamGoneError extends Error {
  readonly code = 'STREAM_GONE' as const;

  constructor(readonly streamId: string) {
    super(`Cannot read from stream, stream does not exist anymore: ${streamId}`);
    this.name = 'StreamGoneError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The stream expires too soon to accept a new subscription (map to HTTP 412). */
export class StreamExpiringError extends Error {
  readonly code = 'STREAM_EXPIRING' as const;

  constructor(
    readonly streamId: string,
    readonly expiresAtMs: number,
  ) {
    super(`Cannot subscribe to stream, stream is about to expire: ${streamId}`);
    this.name = 'StreamExpiringError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A stored entry violates the event-subscription wire format (map to HTTP 412). */
export class StreamCorruptEntryError extends Error {
  readonly code = 'STREAM_CORRUPT_ENTRY' as const;

  constructor(
    readonly streamId: string,
    readonly entryId: string,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(`Corrupt stream entry ${entryId} on ${streamId}: ${detail}`, options);
    this.name = 'StreamCorruptEntryError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
