import type { RedisClient } from '@truefoundry/trueforge-core/request-reply';
import { InMemoryEventStreamStore, InMemoryEventSubscription } from './inMemory';
import { RedisEventSubscription } from './redis';
import type { RestoreLogOptions, RestoreLogOutcome } from './restore';

export type { RestoreLogOptions, RestoreLogOutcome } from './restore';

export interface EventSubscriptionPutOptions {
  /** Sets the lifetime of the whole stream after this append. */
  streamTTLSeconds?: number | undefined;
}

/** `sequence_number` is set only when replaying an old `{sequence}-1` entry. */
export type SequencedEvent<T extends { id: string }> = T & { sequence_number?: number };

export { eventIdTimestampMs, isLegacySequenceEntryId, LEGACY_SEQUENCE_ID_MAX } from './entryId';

export type EventSubscriptionPollOptions = {
  /** Ends the generator promptly on abort, releasing any parked idle wait. */
  signal?: AbortSignal | undefined;
} & (
  | {
      /**
       * Legacy exclusive cursor. Replay events after this sequence (1-indexed).
       * Omit or pass 0 to start from the first event.
       */
      afterSequenceNumber?: number | undefined;
      fromEventId?: never;
      afterEventId?: never;
    }
  | {
      /** Inclusive payload cursor. Replay starts at this event id. */
      fromEventId: string;
      afterSequenceNumber?: never;
      afterEventId?: never;
    }
  | {
      /** Exclusive payload cursor. Replay starts after the last entry with this event id. */
      afterEventId: string;
      afterSequenceNumber?: never;
      fromEventId?: never;
    }
);

/**
 * One turn's resumable event stream, obtained from {@link EventSubscriptionRegistry.get}.
 * Per-stream state (e.g. the sequence counter) lives on the instance and is freed with it.
 */
export interface EventSubscription<T extends { id: string }> {
  /**
   * Rebuilds a missing stream from the whole durable log using event-id stream
   * ids. An existing stream is left in place and only gets its TTL refreshed.
   * Resolves with how the restore ended.
   */
  restoreLog(options: RestoreLogOptions<T>): Promise<RestoreLogOutcome>;

  /** Appends an event. The stream id is `{ulidMillisecond}-{n}` when the event id is a ULID. */
  put(event: T, options?: EventSubscriptionPutOptions): Promise<void>;

  /** First entry id, or undefined when the stream has no entries yet. */
  firstEntryId(): Promise<string | undefined>;

  /** Whether some entry on the live stream carries this payload id. */
  hasEventId(eventId: string): Promise<boolean>;

  /**
   * Subscription admission check, run before SSE headers are sent: rejects with
   * {@link StreamGoneError} when the stream is missing or expires within
   * {@link SUBSCRIBE_STREAM_THRESHOLD_MS}.
   */
  assertSubscribable(): Promise<void>;

  /** Yields events from the chosen cursor, or from the start when none is set. */
  poll(options?: EventSubscriptionPollOptions): AsyncGenerator<SequencedEvent<T>, void, unknown>;
}

/**
 * Hands out stream-scoped {@link EventSubscription}s: Redis-backed when a
 * client is supplied, otherwise views over one shared in-process store.
 */
export class EventSubscriptionRegistry<T extends { id: string }> {
  /** One store for the whole process so producers and subscribers share streams. */
  private readonly memoryStore: InMemoryEventStreamStore<T>;

  constructor(
    private readonly redis: RedisClient | undefined,
    memoryStore?: InMemoryEventStreamStore<T>,
  ) {
    this.memoryStore = memoryStore ?? new InMemoryEventStreamStore<T>();
  }

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
