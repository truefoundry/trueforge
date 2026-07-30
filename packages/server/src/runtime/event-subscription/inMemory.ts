/**
 * Single-process EventSubscription backend with RedisEventSubscription
 * semantics: dense 0-based sequences minted on put, whole-stream TTL applied
 * per put, poll-forever generators, and the same gone/expiring errors. For a
 * future Redis-less boot mode; resume only works within one server replica.
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

export class InMemoryEventSubscription<T extends object> implements EventSubscription<T> {
  private readonly streams = new Map<string, InMemoryStream<T>>();

  put(streamId: string, event: T, options?: EventSubscriptionPutOptions): Promise<number> {
    const stream = this.getLiveStream(streamId) ?? { events: [] };
    this.streams.set(streamId, stream);

    const sequenceNumber = stream.events.length;
    stream.events.push({ ...event, sequence_number: sequenceNumber });

    if (options?.streamTTLSeconds && options.streamTTLSeconds > 0) {
      stream.expiresAtMs = Date.now() + options.streamTTLSeconds * 1_000;
      this.scheduleExpiry(streamId, stream);
    }
    return Promise.resolve(sequenceNumber);
  }

  async *poll(streamId: string, afterSequenceNumber?: number): AsyncGenerator<SequencedEvent<T>, void, unknown> {
    const stream = this.getLiveStream(streamId);
    if (!stream) {
      throw new StreamGoneError(streamId);
    }
    if (stream.expiresAtMs !== undefined && stream.expiresAtMs - Date.now() < SUBSCRIBE_STREAM_THRESHOLD_MS) {
      throw new StreamExpiringError(streamId, stream.expiresAtMs);
    }

    let cursor = afterSequenceNumber === undefined ? 0 : afterSequenceNumber + 1;
    for (;;) {
      const live = this.getLiveStream(streamId);
      if (!live) {
        throw new StreamGoneError(streamId);
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

  /** Returns the stream if it exists and has not passed its TTL; drops it lazily otherwise. */
  private getLiveStream(streamId: string): InMemoryStream<T> | undefined {
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

  /** Frees the log once the TTL passes so finished streams are not retained until next access. */
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
