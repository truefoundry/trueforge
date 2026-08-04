/**
 * Single-process backend mirroring RedisEventSubscription semantics (dense
 * sequences, whole-stream TTL, poll-forever generators, same errors).
 * Resume only works within one replica.
 */
import { EventEmitter, once } from 'node:events';
import {
  StreamGoneError,
  SUBSCRIBE_STREAM_THRESHOLD_MS,
  type EventSubscription,
  type EventSubscriptionPollOptions,
  type EventSubscriptionPutOptions,
  type SequencedEvent,
} from '.';

interface InMemoryStream<T extends object> {
  /** Dense log: the event at index i has sequence_number i + 1 (1-indexed). */
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
  /** Rings per stream id on append and expiry so parked pollers wake instantly. */
  private readonly changes = new EventEmitter();

  constructor() {
    // One listener per parked poller; unlimited concurrent subscribers.
    this.changes.setMaxListeners(0);
  }

  append(streamId: string, event: T, streamTTLSeconds?: number): number {
    const stream = this.getLiveStream(streamId) ?? { events: [] };
    this.streams.set(streamId, stream);

    const sequenceNumber = stream.events.length + 1;
    // Deep-copy so the log is isolated from caller mutations (mirrors JSON round-trip in Redis).
    stream.events.push({ ...structuredClone(event), sequence_number: sequenceNumber });

    if (streamTTLSeconds && streamTTLSeconds > 0) {
      stream.expiresAtMs = Date.now() + streamTTLSeconds * 1_000;
      this.scheduleExpiry(streamId, stream);
    }
    this.changes.emit(streamId);
    return sequenceNumber;
  }

  /** Returns the stream if it exists and has not passed its TTL; drops it lazily otherwise. */
  getLiveStream(streamId: string): InMemoryStream<T> | undefined {
    const stream = this.streams.get(streamId);
    if (!stream) {
      return undefined;
    }
    if (stream.expiresAtMs !== undefined && stream.expiresAtMs <= Date.now()) {
      this.dropStream(streamId, stream);
      return undefined;
    }
    return stream;
  }

  /**
   * Resolves on the next append/expiry of the stream; rejects when the signal
   * aborts (which also detaches the listener, so abandoned waits do not leak).
   */
  async waitForChange(streamId: string, signal?: AbortSignal): Promise<void> {
    await once(this.changes, streamId, { signal });
  }

  /**
   * Evicts a stream: clears its timer, removes it from the map, and wakes any
   * parked pollers so they observe StreamGoneError promptly. Shared by the
   * lazy-expiry path in getLiveStream and the scheduled expiry timer.
   */
  private dropStream(streamId: string, stream: InMemoryStream<T>): void {
    if (stream.expiryTimer) {
      clearTimeout(stream.expiryTimer);
      stream.expiryTimer = undefined;
    }
    if (this.streams.get(streamId) !== stream) {
      return;
    }
    this.streams.delete(streamId);
    this.changes.emit(streamId);
  }

  private scheduleExpiry(streamId: string, stream: InMemoryStream<T>): void {
    if (stream.expiryTimer) {
      clearTimeout(stream.expiryTimer);
    }
    if (stream.expiresAtMs === undefined) {
      return;
    }
    stream.expiryTimer = setTimeout(
      () => {
        this.dropStream(streamId, stream);
      },
      Math.max(0, stream.expiresAtMs - Date.now()),
    );
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

  assertSubscribable(): Promise<void> {
    const stream = this.store.getLiveStream(this.streamId);
    if (!stream) {
      throw new StreamGoneError(this.streamId);
    }
    // Expiring within the threshold is treated as already gone, mirroring the Redis backend.
    if (stream.expiresAtMs !== undefined && stream.expiresAtMs - Date.now() < SUBSCRIBE_STREAM_THRESHOLD_MS) {
      throw new StreamGoneError(this.streamId);
    }
    return Promise.resolve();
  }

  async *poll(
    afterSequenceNumber?: number,
    options?: EventSubscriptionPollOptions,
  ): AsyncGenerator<SequencedEvent<T>, void, unknown> {
    const signal = options?.signal;
    // 0 and omitted both mean "from the start". With 1-indexed sequences stored at
    // index seq-1, "strictly after N" starts at array index N.
    let cursor = afterSequenceNumber === undefined || afterSequenceNumber === 0 ? 0 : afterSequenceNumber;
    for (;;) {
      if (signal?.aborted) {
        return;
      }
      const live = this.store.getLiveStream(this.streamId);
      if (!live) {
        throw new StreamGoneError(this.streamId);
      }
      const end = live.events.length;
      if (cursor >= end) {
        try {
          await this.store.waitForChange(this.streamId, signal);
        } catch (error) {
          if (signal?.aborted) {
            return;
          }
          throw error;
        }
        continue;
      }
      // Deep-copy each yielded event so consumers cannot mutate the stored log.
      // Snapshot `end` so appends during yield are left for the next pass.
      while (cursor < end) {
        const event = live.events[cursor];
        if (event === undefined) {
          throw new Error(`Corrupt stream ${this.streamId}: missing event at index ${String(cursor)}`);
        }
        cursor += 1;
        yield structuredClone(event);
      }
    }
  }
}
