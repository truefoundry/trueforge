/**
 * Single-process backend mirroring RedisEventSubscription semantics (dense
 * sequences, whole-stream TTL, poll-forever generators, same errors).
 * Resume only works within one replica.
 */
import {
  sleep,
  StreamExpiringError,
  StreamGoneError,
  SUBSCRIBE_STREAM_POLL_SLEEP_INTERVAL_MS,
  SUBSCRIBE_STREAM_THRESHOLD_MS,
  type EventSubscription,
  type EventSubscriptionPutOptions,
  type SequencedEvent,
} from '.';

interface InMemoryStream<T extends object> {
  /** Dense log: the event at index i has sequence_number i. */
  events: SequencedEvent<T>[];
  /** Undefined = no TTL set yet (mirrors a Redis key without EXPIRE). */
  expiresAtMs?: number | undefined;
  expiryTimer?: NodeJS.Timeout | undefined;
}

/**
 * Owns the stream logs and their TTLs; the expiry timer is the in-process
 * equivalent of Redis key eviction.
 */
export class InMemoryEventStreamStore<T extends object> {
  private readonly streams = new Map<string, InMemoryStream<T>>();

  append(streamId: string, event: T, streamTTLSeconds?: number): number {
    const stream = this.getLiveStream(streamId) ?? { events: [] };
    this.streams.set(streamId, stream);

    const sequenceNumber = stream.events.length;
    stream.events.push({ ...event, sequence_number: sequenceNumber });

    if (streamTTLSeconds && streamTTLSeconds > 0) {
      stream.expiresAtMs = Date.now() + streamTTLSeconds * 1_000;
      this.scheduleExpiry(streamId, stream);
    }
    return sequenceNumber;
  }

  /** Returns the stream if it exists and has not passed its TTL; drops it lazily otherwise. */
  getLiveStream(streamId: string): InMemoryStream<T> | undefined {
    const stream = this.streams.get(streamId);
    if (!stream) {
      return undefined;
    }
    if (stream.expiresAtMs !== undefined && stream.expiresAtMs <= Date.now()) {
      this.streams.delete(streamId);
      return undefined;
    }
    return stream;
  }

  private scheduleExpiry(streamId: string, stream: InMemoryStream<T>): void {
    if (stream.expiryTimer) {
      clearTimeout(stream.expiryTimer);
    }
    if (stream.expiresAtMs === undefined) {
      return;
    }
    stream.expiryTimer = setTimeout(() => {
      if (this.streams.get(streamId) === stream) {
        this.streams.delete(streamId);
      }
    }, stream.expiresAtMs - Date.now());
    stream.expiryTimer.unref();
  }
}

/** Stream-scoped view over the shared store; implements the transport contract. */
export class InMemoryEventSubscription<T extends object> implements EventSubscription<T> {
  constructor(
    private readonly store: InMemoryEventStreamStore<T>,
    private readonly streamId: string,
  ) {}

  put(event: T, options?: EventSubscriptionPutOptions): Promise<number> {
    return Promise.resolve(this.store.append(this.streamId, event, options?.streamTTLSeconds));
  }

  async *poll(afterSequenceNumber?: number): AsyncGenerator<SequencedEvent<T>, void, unknown> {
    const stream = this.store.getLiveStream(this.streamId);
    if (!stream) {
      throw new StreamGoneError(this.streamId);
    }
    if (stream.expiresAtMs !== undefined && stream.expiresAtMs - Date.now() < SUBSCRIBE_STREAM_THRESHOLD_MS) {
      throw new StreamExpiringError(this.streamId, stream.expiresAtMs);
    }

    let cursor = afterSequenceNumber === undefined ? 0 : afterSequenceNumber + 1;
    for (;;) {
      const live = this.store.getLiveStream(this.streamId);
      if (!live) {
        throw new StreamGoneError(this.streamId);
      }
      const batch = live.events.slice(cursor);
      if (batch.length === 0) {
        await sleep(SUBSCRIBE_STREAM_POLL_SLEEP_INTERVAL_MS);
        continue;
      }
      cursor += batch.length;
      yield* batch;
    }
  }
}
