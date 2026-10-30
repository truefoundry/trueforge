/**
 * Single-process backend mirroring RedisEventSubscription semantics (dense
 * sequences, whole-stream TTL, poll-forever generators, same errors).
 * Resume only works within one replica.
 */
import { EventEmitter, once } from 'node:events';
import {
  StreamGoneError,
  StreamOwnerMismatchError,
  SUBSCRIBE_STREAM_THRESHOLD_MS,
  type EventSubscription,
  type EventSubscriptionPollOptions,
  type EventSubscriptionPutOptions,
  type SequencedEvent,
} from '.';
import { applyEventLogRepair, eventIdOf, type RepairLogOptions } from './repair';

interface InMemoryStream<T extends object> {
  /** Appended in increasing sequence_number order. */
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
  /** Survives stream eviction so a stale producer cannot recreate a missing log. */
  private readonly owners = new Map<string, string>();
  /** Rings per stream id on append and expiry so parked pollers wake instantly. */
  private readonly changes = new EventEmitter();

  constructor() {
    // One listener per parked poller; unlimited concurrent subscribers.
    this.changes.setMaxListeners(0);
  }

  claimOwner(streamId: string, executorId: string): void {
    this.owners.set(streamId, executorId);
  }

  /**
   * Appends at an explicit sequence. A sequence at or below the tail is a duplicate
   * when the tail already has that event id, and a conflict otherwise.
   */
  appendExplicit(input: {
    streamId: string;
    event: T;
    sequenceNumber: number;
    eventId: string | undefined;
    executorId: string | undefined;
    checkOwner: boolean;
    streamTTLSeconds: number | undefined;
  }): 'ok' | 'duplicate' | 'owner_mismatch' | 'conflict' {
    const owner = this.owners.get(input.streamId);
    if (input.checkOwner && owner !== undefined && owner !== input.executorId) {
      return 'owner_mismatch';
    }
    const stream = this.getLiveStream(input.streamId) ?? { events: [] };
    const last = stream.events[stream.events.length - 1];
    if (last !== undefined && input.sequenceNumber <= last.sequence_number) {
      const tailId = eventIdOf(last);
      if (input.eventId !== undefined && tailId === input.eventId) {
        return 'duplicate';
      }
      return 'conflict';
    }
    this.streams.set(input.streamId, stream);
    // Deep-copy so the log is isolated from caller mutations (mirrors JSON round-trip in Redis).
    stream.events.push({ ...structuredClone(input.event), sequence_number: input.sequenceNumber });
    if (input.streamTTLSeconds !== undefined && input.streamTTLSeconds > 0) {
      stream.expiresAtMs = Date.now() + input.streamTTLSeconds * 1_000;
      this.scheduleExpiry(input.streamId, stream);
    }
    this.changes.emit(input.streamId);
    return 'ok';
  }

  readTail(streamId: string): { eventId: string; sequenceNumber: number } | undefined {
    const stream = this.getLiveStream(streamId);
    const last = stream?.events[stream.events.length - 1];
    if (last === undefined) {
      return undefined;
    }
    return { eventId: eventIdOf(last) ?? '', sequenceNumber: last.sequence_number };
  }

  /** Drops the log and keeps the owner, matching Redis stream-key expiry. */
  evictStream(streamId: string): void {
    const stream = this.streams.get(streamId);
    if (stream === undefined) {
      return;
    }
    this.dropStream(streamId, stream);
  }

  /** Refreshes TTL on a live stream. Sequence numbers already follow the log length. */
  refreshStreamTtl(streamId: string, streamTTLSeconds?: number): void {
    const stream = this.getLiveStream(streamId);
    if (!stream || !streamTTLSeconds || streamTTLSeconds <= 0) {
      return;
    }
    stream.expiresAtMs = Date.now() + streamTTLSeconds * 1_000;
    this.scheduleExpiry(streamId, stream);
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
  private nextSequenceNumber = 1;

  constructor(
    private readonly store: InMemoryEventStreamStore<T>,
    private readonly streamId: string,
  ) {}

  repairLog(options: RepairLogOptions<T>): Promise<void> {
    const executorId = options.executorId;
    return applyEventLogRepair({
      entries: options.entries,
      persistSequences: options.persistSequences,
      claimOwner:
        executorId === undefined
          ? undefined
          : () => {
              this.store.claimOwner(this.streamId, executorId);
              return Promise.resolve();
            },
      readTail: () => Promise.resolve(this.store.readTail(this.streamId)),
      append: entry => {
        const outcome = this.store.appendExplicit({
          streamId: this.streamId,
          event: entry.event,
          sequenceNumber: entry.sequence_number,
          eventId: entry.id,
          executorId,
          checkOwner: false,
          streamTTLSeconds: options.streamTTLSeconds,
        });
        if (outcome === 'ok') {
          return Promise.resolve('appended');
        }
        if (outcome === 'duplicate') {
          return Promise.resolve('duplicate');
        }
        if (outcome === 'owner_mismatch') {
          return Promise.reject(new StreamOwnerMismatchError(this.streamId));
        }
        return Promise.reject(
          new Error(`explicit stream id ${String(entry.sequence_number)} conflicts on ${this.streamId}`),
        );
      },
      refreshTtl: () => {
        this.store.refreshStreamTtl(this.streamId, options.streamTTLSeconds);
        return Promise.resolve();
      },
      refreshTtlOnUntouchedStream: executorId !== undefined,
    }).then(next => {
      this.nextSequenceNumber = next;
    });
  }

  put(event: T, options?: EventSubscriptionPutOptions): Promise<number> {
    const sequenceNumber = this.nextSequenceNumber;
    this.nextSequenceNumber += 1;
    const outcome = this.store.appendExplicit({
      streamId: this.streamId,
      event,
      sequenceNumber,
      eventId: eventIdOf(event),
      executorId: options?.executorId,
      checkOwner: true,
      streamTTLSeconds: options?.streamTTLSeconds,
    });
    if (outcome === 'owner_mismatch') {
      return Promise.reject(new StreamOwnerMismatchError(this.streamId));
    }
    if (outcome === 'conflict') {
      return Promise.reject(new Error(`explicit stream id ${String(sequenceNumber)} conflicts on ${this.streamId}`));
    }
    return Promise.resolve(sequenceNumber);
  }

  assertSubscribable(): Promise<void> {
    const stream = this.store.getLiveStream(this.streamId);
    if (!stream) {
      return Promise.reject(new StreamGoneError(this.streamId));
    }
    // Expiring within the threshold is treated as already gone, mirroring the Redis backend.
    if (stream.expiresAtMs !== undefined && stream.expiresAtMs - Date.now() < SUBSCRIBE_STREAM_THRESHOLD_MS) {
      return Promise.reject(new StreamGoneError(this.streamId));
    }
    return Promise.resolve();
  }

  async *poll(
    afterSequenceNumber?: number,
    options?: EventSubscriptionPollOptions,
  ): AsyncGenerator<SequencedEvent<T>, void, unknown> {
    const signal = options?.signal;
    // 0 and omitted both mean "from the start". Yield events whose sequence is strictly greater.
    let after = afterSequenceNumber === undefined || afterSequenceNumber === 0 ? 0 : afterSequenceNumber;
    for (;;) {
      if (signal?.aborted) {
        return;
      }
      const live = this.store.getLiveStream(this.streamId);
      if (!live) {
        throw new StreamGoneError(this.streamId);
      }
      const pending = live.events.filter(event => event.sequence_number > after);
      if (pending.length === 0) {
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
      for (const event of pending) {
        after = event.sequence_number;
        yield structuredClone(event);
      }
    }
  }
}
