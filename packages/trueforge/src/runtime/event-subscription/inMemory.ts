/**
 * Single-process backend mirroring RedisEventSubscription semantics
 * (ULID-millisecond entry ids, whole-stream TTL, poll-forever generators).
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
import {
  entryIdMilliseconds,
  EventIdSeek,
  eventIdTimestampMs,
  exclusiveCursorBeforeMillisecond,
  isEntryAfterCursor,
  isLegacySequenceEntryId,
} from './entryId';
import { applyEventLogRepair, eventIdOf, type RepairLogOptions } from './repair';

interface StoredEvent<T extends object> {
  entryId: string;
  event: T;
}

interface InMemoryStream<T extends object> {
  /** Appended in Redis stream-id order. */
  events: StoredEvent<T>[];
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
   * Appends with a `{millisecond}-{n}` id. The same payload already at the tail
   * is a duplicate. A millisecond older than the tail reuses the tail millisecond.
   */
  appendEvent(input: {
    streamId: string;
    event: T;
    executorId: string | undefined;
    checkOwner: boolean;
    streamTTLSeconds: number | undefined;
  }): 'ok' | 'duplicate' | 'owner_mismatch' {
    const owner = this.owners.get(input.streamId);
    if (input.checkOwner && owner !== undefined && owner !== input.executorId) {
      return 'owner_mismatch';
    }
    const stream = this.getLiveStream(input.streamId) ?? { events: [] };
    const event = structuredClone(input.event);
    const payload = JSON.stringify(event);
    const last = stream.events[stream.events.length - 1];
    if (last !== undefined && JSON.stringify(last.event) === payload) {
      return 'duplicate';
    }
    this.streams.set(input.streamId, stream);
    const eventId = eventIdOf(event);
    const timestamp = eventId === undefined ? undefined : eventIdTimestampMs(eventId);
    stream.events.push({ entryId: this.nextEntryId(stream, timestamp ?? Date.now()), event });
    if (input.streamTTLSeconds !== undefined && input.streamTTLSeconds > 0) {
      stream.expiresAtMs = Date.now() + input.streamTTLSeconds * 1_000;
      this.scheduleExpiry(input.streamId, stream);
    }
    this.changes.emit(input.streamId);
    return 'ok';
  }

  readTail(streamId: string): { eventId: string; payload: string } | undefined {
    const stream = this.getLiveStream(streamId);
    const last = stream?.events[stream.events.length - 1];
    if (last === undefined) {
      return undefined;
    }
    return { eventId: eventIdOf(last.event) ?? '', payload: JSON.stringify(last.event) };
  }

  firstEntryId(streamId: string): string | undefined {
    return this.getLiveStream(streamId)?.events[0]?.entryId;
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

  /**
   * Redis `XADD <ms>-*` : counter 0 when the millisecond is newer than the last
   * id, otherwise the last millisecond's counter plus one.
   */
  private nextEntryId(stream: InMemoryStream<T>, milliseconds: number): string {
    const last = stream.events[stream.events.length - 1];
    if (last === undefined) {
      return `${String(milliseconds)}-0`;
    }
    const lastMilliseconds = entryIdMilliseconds(last.entryId);
    if (milliseconds > lastMilliseconds) {
      return `${String(milliseconds)}-0`;
    }
    const separator = last.entryId.indexOf('-');
    const lastCounter = Number(last.entryId.slice(separator + 1));
    return `${String(lastMilliseconds)}-${String(lastCounter + 1)}`;
  }
}

/** Stream-scoped view over the shared store; implements the transport contract. */
export class InMemoryEventSubscription<T extends object> implements EventSubscription<T> {
  constructor(
    private readonly store: InMemoryEventStreamStore<T>,
    private readonly streamId: string,
  ) {}

  repairLog(options: RepairLogOptions<T>): Promise<void> {
    const executorId = options.executorId;
    return applyEventLogRepair({
      entries: options.entries,
      claimOwner:
        executorId === undefined
          ? undefined
          : () => {
              this.store.claimOwner(this.streamId, executorId);
              return Promise.resolve();
            },
      readTail: () => Promise.resolve(this.store.readTail(this.streamId)),
      append: entry => {
        const outcome = this.store.appendEvent({
          streamId: this.streamId,
          event: entry.event,
          executorId,
          checkOwner: false,
          streamTTLSeconds: options.streamTTLSeconds,
        });
        if (outcome === 'owner_mismatch') {
          return Promise.reject(new StreamOwnerMismatchError(this.streamId));
        }
        return Promise.resolve(outcome === 'duplicate' ? 'duplicate' : 'appended');
      },
      refreshTtl: () => {
        this.store.refreshStreamTtl(this.streamId, options.streamTTLSeconds);
        return Promise.resolve();
      },
      refreshTtlOnUntouchedStream: executorId !== undefined,
    });
  }

  put(event: T, options?: EventSubscriptionPutOptions): Promise<void> {
    const outcome = this.store.appendEvent({
      streamId: this.streamId,
      event,
      executorId: options?.executorId,
      checkOwner: true,
      streamTTLSeconds: options?.streamTTLSeconds,
    });
    if (outcome === 'owner_mismatch') {
      return Promise.reject(new StreamOwnerMismatchError(this.streamId));
    }
    return Promise.resolve();
  }

  firstEntryId(): Promise<string | undefined> {
    return Promise.resolve(this.store.firstEntryId(this.streamId));
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
    if (options?.fromEventId !== undefined || options?.afterEventId !== undefined) {
      yield* this.pollByEventId(options);
      return;
    }
    const signal = options?.signal;
    const readCursor =
      afterSequenceNumber === undefined || afterSequenceNumber === 0 ? '0-0' : `${String(afterSequenceNumber + 1)}-0`;
    let index = 0;
    for (;;) {
      if (signal?.aborted) {
        return;
      }
      const live = this.store.getLiveStream(this.streamId);
      if (!live) {
        throw new StreamGoneError(this.streamId);
      }
      const end = live.events.length;
      if (index >= end) {
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
      while (index < end) {
        const stored = live.events[index];
        index += 1;
        if (stored === undefined) {
          throw new Error(`Corrupt stream ${this.streamId}: missing event at index ${String(index - 1)}`);
        }
        if (!isEntryAfterCursor(stored.entryId, readCursor)) {
          continue;
        }
        yield this.polled(stored);
      }
    }
  }

  private async *pollByEventId(
    options: EventSubscriptionPollOptions,
  ): AsyncGenerator<SequencedEvent<T>, void, unknown> {
    const fromEventId = options.fromEventId;
    const afterEventId = options.afterEventId;
    const eventId = fromEventId ?? afterEventId;
    if (eventId === undefined || (fromEventId !== undefined && afterEventId !== undefined)) {
      throw new Error('Pass only one of fromEventId or afterEventId');
    }
    const signal = options.signal;
    const seek = new EventIdSeek<SequencedEvent<T> & { id: string }>(
      fromEventId !== undefined ? 'from' : 'after',
      eventId,
    );
    const timestamp = eventIdTimestampMs(eventId);
    const readCursor = timestamp === undefined ? '0-0' : exclusiveCursorBeforeMillisecond(timestamp);
    let index = 0;
    let scanning = true;
    for (;;) {
      if (signal?.aborted) {
        return;
      }
      const live = this.store.getLiveStream(this.streamId);
      if (!live) {
        throw new StreamGoneError(this.streamId);
      }
      const end = live.events.length;
      if (index >= end) {
        if (scanning) {
          scanning = false;
          for (const event of seek.caughtUp()) {
            yield structuredClone(event);
          }
        }
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
      while (index < end) {
        const stored = live.events[index];
        index += 1;
        if (stored === undefined) {
          throw new Error(`Corrupt stream ${this.streamId}: missing event at index ${String(index - 1)}`);
        }
        if (!isEntryAfterCursor(stored.entryId, readCursor)) {
          continue;
        }
        const eventIdOnEntry = eventIdOf(stored.event);
        if (eventIdOnEntry === undefined) {
          throw new Error(`Corrupt stream ${this.streamId}: missing event id`);
        }
        for (const event of seek.push({ ...this.polled(stored), id: eventIdOnEntry })) {
          yield event;
        }
      }
    }
  }

  private polled(stored: StoredEvent<T>): SequencedEvent<T> {
    const event = structuredClone(stored.event);
    if (!isLegacySequenceEntryId(stored.entryId)) {
      return event;
    }
    return { ...event, sequence_number: entryIdMilliseconds(stored.entryId) };
  }
}
