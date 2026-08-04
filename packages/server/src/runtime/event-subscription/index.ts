import type { RedisClientType } from 'redis';
import { InMemoryEventStreamStore, InMemoryEventSubscription } from './inMemory';
import { RedisEventSubscription } from './redis';

export interface EventSubscriptionPutOptions {
  /** Sets the lifetime of the whole stream after this append. */
  streamTTLSeconds?: number | undefined;
}

export type SequencedEvent<T extends object> = T & { sequence_number: number };

export interface EventSubscriptionPollOptions {
  /** Ends the generator promptly on abort, releasing any parked idle wait. */
  signal?: AbortSignal | undefined;
}

/**
 * One turn's resumable event stream, obtained from {@link EventSubscriptionRegistry.get}.
 * Per-stream state (e.g. the sequence counter) lives on the instance and is freed with it.
 */
export interface EventSubscription<T extends object> {
  /** Appends an event, assigns its sequence number, and returns that number. */
  put(event: T, options?: EventSubscriptionPutOptions): Promise<number>;

  /**
   * Subscription admission check, run before SSE headers are sent: rejects with
   * {@link StreamGoneError} when the stream is missing or expires within
   * {@link SUBSCRIBE_STREAM_THRESHOLD_MS}.
   */
  assertSubscribable(): Promise<void>;

  /**
   * Yields events strictly after the supplied sequence number.
   * Sequences are 1-indexed; omit or pass 0 to start from the first event.
   */
  poll(
    afterSequenceNumber?: number,
    options?: EventSubscriptionPollOptions,
  ): AsyncGenerator<SequencedEvent<T>, void, unknown>;
}

/**
 * Hands out stream-scoped {@link EventSubscription}s: Redis-backed when a
 * client is supplied, otherwise views over one shared in-process store.
 */
export class EventSubscriptionRegistry<T extends object> {
  /** One store for the whole process so producers and subscribers share streams. */
  private readonly memoryStore = new InMemoryEventStreamStore<T>();

  constructor(private readonly redis: RedisClientType | undefined) {}

  get(streamId: string): EventSubscription<T> {
    if (this.redis) {
      return new RedisEventSubscription<T>(this.redis, streamId);
    }
    return new InMemoryEventSubscription(this.memoryStore, streamId);
  }
}

/** Reject new subscriptions when the stream expires within this window. */
export const SUBSCRIBE_STREAM_THRESHOLD_MS = 60 * 1_000;

/** The stream expired or was never created (map to HTTP 412). */
export class StreamGoneError extends Error {
  readonly code = 'STREAM_GONE' as const;

  constructor(readonly streamId: string) {
    super(`Cannot read from stream, stream does not exist anymore: ${streamId}`);
    this.name = 'StreamGoneError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
