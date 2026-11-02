import type { RedisClient } from '@truefoundry/trueforge-core/request-reply';
import { InMemoryEventStreamStore, InMemoryEventSubscription } from './inMemory';
import { RedisEventSubscription } from './redis';
import type { RepairLogOptions } from './repair';

export type { EventLogEntry, RepairLogOptions } from './repair';

export interface EventSubscriptionPutOptions {
  /** Sets the lifetime of the whole stream after this append. */
  streamTTLSeconds?: number | undefined;
  /**
   * XADD runs only when the stream-owner key is unset or equals this id.
   * A missing stream still rejects a caller that does not own the key.
   */
  executorId?: string | undefined;
}

/** `sequence_number` is set only when replaying an old `{sequence}-1` entry. */
export type SequencedEvent<T extends object> = T & { sequence_number?: number };

export { isLegacySequenceEntryId, LEGACY_SEQUENCE_ID_MAX } from './entryId';

export interface EventSubscriptionPollOptions {
  /** Ends the generator promptly on abort, releasing any parked idle wait. */
  signal?: AbortSignal | undefined;
  /** Inclusive payload cursor. Replay starts at this event id. */
  fromEventId?: string | undefined;
  /** Exclusive payload cursor. Replay starts after the last entry with this event id. */
  afterEventId?: string | undefined;
}

/**
 * One turn's resumable event stream, obtained from {@link EventSubscriptionRegistry.get}.
 * Per-stream state (e.g. the sequence counter) lives on the instance and is freed with it.
 */
export interface EventSubscription<T extends object> {
  /**
   * Rebuilds a missing or behind stream from the durable log using event-id
   * stream ids. An existing stream whose tail is already the log tail is left
   * in place. Pass `executorId` only for the database owner that will put.
   */
  repairLog(options: RepairLogOptions<T>): Promise<void>;

  /** Appends an event. The stream id is `{ulidMillisecond}-{n}` when the event id is a ULID. */
  put(event: T, options?: EventSubscriptionPutOptions): Promise<void>;

  /** First entry id, or undefined when the stream has no entries yet. */
  firstEntryId(): Promise<string | undefined>;

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

  constructor(private readonly redis: RedisClient | undefined) {}

  get(streamId: string): EventSubscription<T> {
    if (this.redis) {
      return new RedisEventSubscription<T>(this.redis, streamId);
    }
    return new InMemoryEventSubscription(this.memoryStore, streamId);
  }

  /**
   * Drops the live log the way a TTL expiry does, and keeps the stream-owner key
   * so a stale producer still cannot recreate it.
   */
  evictStream(streamId: string): Promise<void> {
    if (this.redis) {
      return this.redis.del(streamId).then(() => undefined);
    }
    this.memoryStore.evictStream(streamId);
    return Promise.resolve();
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

/** put refused because the stream-owner key belongs to another executor. */
export class StreamOwnerMismatchError extends Error {
  readonly code = 'STREAM_OWNER_MISMATCH' as const;

  constructor(readonly streamId: string) {
    super(`Cannot append to stream ${streamId}: caller is not the stream owner`);
    this.name = 'StreamOwnerMismatchError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
