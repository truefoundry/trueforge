/**
 * Process-local EventSubscription backend for tests and single-replica runs.
 * Entry ids are `{millisecond}-{n}`; streams expire after an optional TTL.
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
  eventIdSeekCursor,
  eventIdTimestampMs,
  isEntryAfterCursor,
  isLegacySequenceEntryId,
} from './entryId';
import { applyEventLogRepair, type AppendAfterTailResult, type RepairLogOptions, type StreamTail } from './repair';

function ttlDeadline(streamTTLSeconds: number | undefined): number | undefined {
  return streamTTLSeconds !== undefined && streamTTLSeconds > 0 ? Date.now() + streamTTLSeconds * 1_000 : undefined;
}

interface StoredEvent<T extends { id: string }> {
  entryId: string;
  event: T;
}

interface InMemoryStream<T extends { id: string }> {
  /** Appended in entry-id order. */
  events: StoredEvent<T>[];
  /** Undefined until the first put/repair sets a TTL. */
  expiresAtMs?: number | undefined;
  expiryTimer?: NodeJS.Timeout | undefined;
}

/** Owns per-stream logs, owners, and TTL timers for this process. */
export class InMemoryEventStreamStore<T extends { id: string }> {
  private readonly streams = new Map<string, InMemoryStream<T>>();
  /**
   * Survives an explicit eviction so a stale producer cannot recreate a missing
   * log. Expires with the stream TTL so idle turns do not accumulate owners.
   */
  private readonly owners = new Map<string, { executorId: string; expiresAtMs: number | undefined }>();
  /** Rings per stream id on append and expiry so parked pollers wake instantly. */
  private readonly changes = new EventEmitter();

  constructor() {
    // One listener per parked poller; unlimited concurrent subscribers.
    this.changes.setMaxListeners(0);
  }

  claimOwner(input: { streamId: string; executorId: string; streamTTLSeconds: number | undefined }): void {
    this.owners.set(input.streamId, {
      executorId: input.executorId,
      expiresAtMs: ttlDeadline(input.streamTTLSeconds),
    });
  }

  /**
   * Live put with a `{millisecond}-{n}` id. A millisecond older than the tail
   * reuses the tail millisecond. Identical payloads are kept.
   */
  appendEvent(input: {
    streamId: string;
    event: T;
    executorId: string | undefined;
    streamTTLSeconds: number | undefined;
  }): 'ok' | 'owner_mismatch' {
    const owner = this.liveOwner(input.streamId);
    if (owner !== undefined && owner !== input.executorId) {
      return 'owner_mismatch';
    }
    const stream = this.getLiveStream(input.streamId) ?? { events: [] };
    this.streams.set(input.streamId, stream);
    this.push(stream, input.event);
    this.refreshStreamTtl(input.streamId, input.streamTTLSeconds);
    this.changes.emit(input.streamId);
    return 'ok';
  }

  /** Repair backfill: appends only while the tail is still `tailEntryId`. */
  appendAfterTail(input: {
    streamId: string;
    tailEntryId: string | undefined;
    events: T[];
    streamTTLSeconds: number | undefined;
  }): AppendAfterTailResult {
    const stream = this.getLiveStream(input.streamId) ?? { events: [] };
    if (stream.events[stream.events.length - 1]?.entryId !== input.tailEntryId) {
      return { status: 'stale' };
    }
    this.streams.set(input.streamId, stream);
    for (const event of input.events) {
      this.push(stream, event);
    }
    this.refreshStreamTtl(input.streamId, input.streamTTLSeconds);
    this.changes.emit(input.streamId);
    const written = stream.events[stream.events.length - 1];
    if (written === undefined) {
      throw new Error('Stream repair append wrote no entry');
    }
    return { status: 'ok', tailEntryId: written.entryId };
  }

  readTail(streamId: string): StreamTail | undefined {
    const stream = this.getLiveStream(streamId);
    const last = stream?.events[stream.events.length - 1];
    if (last === undefined) {
      return undefined;
    }
    return { entryId: last.entryId, eventId: last.event.id, payload: JSON.stringify(last.event) };
  }

  firstEntryId(streamId: string): string | undefined {
    return this.getLiveStream(streamId)?.events[0]?.entryId;
  }

  hasEventId(streamId: string, eventId: string): boolean {
    return this.getLiveStream(streamId)?.events.some(stored => stored.event.id === eventId) ?? false;
  }

  /** Drops the log and keeps the owner so a stale producer cannot recreate it. */
  evictStream(streamId: string): void {
    const stream = this.streams.get(streamId);
    if (stream === undefined) {
      return;
    }
    this.dropStream(streamId, stream);
  }

  /** Refreshes TTL on a live stream and its owner. */
  refreshStreamTtl(streamId: string, streamTTLSeconds: number | undefined): void {
    const deadline = ttlDeadline(streamTTLSeconds);
    if (deadline === undefined) {
      return;
    }
    const owner = this.owners.get(streamId);
    if (owner !== undefined) {
      owner.expiresAtMs = deadline;
    }
    const stream = this.getLiveStream(streamId);
    if (!stream) {
      return;
    }
    stream.expiresAtMs = deadline;
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
      this.dropOwnerIfExpired(streamId);
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
        this.dropOwnerIfExpired(streamId);
      },
      Math.max(0, stream.expiresAtMs - Date.now()),
    );
    stream.expiryTimer.unref();
  }

  private liveOwner(streamId: string): string | undefined {
    this.dropOwnerIfExpired(streamId);
    return this.owners.get(streamId)?.executorId;
  }

  private dropOwnerIfExpired(streamId: string): void {
    const expiresAtMs = this.owners.get(streamId)?.expiresAtMs;
    if (expiresAtMs !== undefined && expiresAtMs <= Date.now()) {
      this.owners.delete(streamId);
    }
  }

  private push(stream: InMemoryStream<T>, event: T): void {
    const copy = structuredClone(event);
    stream.events.push({ entryId: this.nextEntryId(stream, eventIdTimestampMs(copy.id) ?? Date.now()), event: copy });
  }

  /**
   * Next `{ms}-{n}` id: counter resets when `milliseconds` moves forward,
   * otherwise increments within the current millisecond.
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
export class InMemoryEventSubscription<T extends { id: string }> implements EventSubscription<T> {
  constructor(
    private readonly store: InMemoryEventStreamStore<T>,
    private readonly streamId: string,
  ) {}

  repairLog(options: RepairLogOptions<T>): Promise<void> {
    const executorId = options.executorId;
    return applyEventLogRepair({
      readPages: options.readPages,
      claimOwner:
        executorId === undefined
          ? undefined
          : () => {
              this.store.claimOwner({
                streamId: this.streamId,
                executorId,
                streamTTLSeconds: options.streamTTLSeconds,
              });
              return Promise.resolve();
            },
      readTail: () => Promise.resolve(this.store.readTail(this.streamId)),
      appendAfterTail: batch =>
        Promise.resolve(
          this.store.appendAfterTail({
            streamId: this.streamId,
            ...batch,
            streamTTLSeconds: options.streamTTLSeconds,
          }),
        ),
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
      streamTTLSeconds: options?.streamTTLSeconds,
    });
    if (outcome === 'owner_mismatch') {
      return Promise.reject(new StreamOwnerMismatchError(this.streamId));
    }
    return Promise.resolve();
  }

  hasEventId(eventId: string): Promise<boolean> {
    return Promise.resolve(this.store.hasEventId(this.streamId, eventId));
  }

  firstEntryId(): Promise<string | undefined> {
    return Promise.resolve(this.store.firstEntryId(this.streamId));
  }

  assertSubscribable(): Promise<void> {
    const stream = this.store.getLiveStream(this.streamId);
    if (!stream) {
      return Promise.reject(new StreamGoneError(this.streamId));
    }
    // Same admission window as the shared subscribe threshold.
    if (stream.expiresAtMs !== undefined && stream.expiresAtMs - Date.now() < SUBSCRIBE_STREAM_THRESHOLD_MS) {
      return Promise.reject(new StreamGoneError(this.streamId));
    }
    return Promise.resolve();
  }

  async *poll(options?: EventSubscriptionPollOptions): AsyncGenerator<SequencedEvent<T>, void, unknown> {
    const afterSequenceNumber = options?.afterSequenceNumber;
    const fromEventId = options?.fromEventId;
    const afterEventId = options?.afterEventId;
    const cursors = [afterSequenceNumber, fromEventId, afterEventId].filter(value => value !== undefined);
    if (cursors.length > 1) {
      throw new Error('Pass only one of afterSequenceNumber, fromEventId, or afterEventId');
    }
    if (fromEventId !== undefined || afterEventId !== undefined) {
      yield* this.pollByEventId(options ?? {});
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
    if (eventId === undefined) {
      throw new Error('Pass fromEventId or afterEventId');
    }
    const signal = options.signal;
    const seek = new EventIdSeek<SequencedEvent<T>>(fromEventId !== undefined ? 'from' : 'after', eventId);
    const readCursor = eventIdSeekCursor({ eventId, firstEntryId: this.store.firstEntryId(this.streamId) });
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
          // An append during the replay yield happened before this poller was
          // waiting. Look at the log again before parking.
          continue;
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
        for (const event of seek.push(this.polled(stored))) {
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
