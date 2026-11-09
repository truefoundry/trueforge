/**
 * Process-local EventSubscription backend for tests and single-replica runs.
 * Entry ids are `{millisecond}-{n}`; streams expire after an optional TTL.
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
import {
  entryIdMilliseconds,
  EventIdSeek,
  eventIdTimestampMs,
  isEntryAfterCursor,
  isLegacySequenceEntryId,
} from './entryId';
import { applyEventLogRestore, type RestoreLogOptions, type RestoreLogOutcome } from './restore';
import { shareRestore, withLocalRestoreBudget } from './restoreFlight';

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
  /** Undefined until the first put/restore sets a TTL. */
  expiresAtMs?: number | undefined;
  expiryTimer?: NodeJS.Timeout | undefined;
}

/** Owns per-stream logs and TTL timers for this process. */
export class InMemoryEventStreamStore<T extends { id: string }> {
  private readonly streams = new Map<string, InMemoryStream<T>>();
  /** Rings per stream id on append and expiry so parked pollers wake instantly. */
  private readonly changes = new EventEmitter();

  constructor() {
    // One listener per parked poller; unlimited concurrent subscribers.
    this.changes.setMaxListeners(0);
  }

  /**
   * Live put with a `{millisecond}-{n}` id. A millisecond older than the tail
   * reuses the tail millisecond. Identical payloads are kept.
   */
  appendEvent(input: { streamId: string; event: T; streamTTLSeconds: number | undefined }): void {
    const stream = this.getLiveStream(input.streamId) ?? { events: [] };
    this.streams.set(input.streamId, stream);
    this.push(stream, input.event);
    this.refreshStreamTtl(input.streamId, input.streamTTLSeconds);
    this.changes.emit(input.streamId);
  }

  /**
   * Publishes a fully built log only while the stream is still absent.
   * The check and the insert are synchronous, so a concurrent put cannot land in between.
   */
  installIfAbsent(input: { streamId: string; events: readonly T[]; streamTTLSeconds: number | undefined }): boolean {
    if (input.events.length === 0) {
      return true;
    }
    const stream: InMemoryStream<T> = { events: [] };
    for (const event of input.events) {
      this.push(stream, event);
    }
    if (this.getLiveStream(input.streamId) !== undefined) {
      return false;
    }
    this.streams.set(input.streamId, stream);
    this.refreshStreamTtl(input.streamId, input.streamTTLSeconds);
    this.changes.emit(input.streamId);
    return true;
  }

  readTailEntryId(streamId: string): string | undefined {
    const stream = this.getLiveStream(streamId);
    return stream?.events[stream.events.length - 1]?.entryId;
  }

  firstEntryId(streamId: string): string | undefined {
    return this.getLiveStream(streamId)?.events[0]?.entryId;
  }

  hasEventId({ streamId, eventId }: { streamId: string; eventId: string }): boolean {
    return this.getLiveStream(streamId)?.events.some(stored => stored.event.id === eventId) ?? false;
  }

  /** Drops the log the way a TTL expiry does. */
  evictStream(streamId: string): void {
    const stream = this.streams.get(streamId);
    if (stream === undefined) {
      return;
    }
    this.dropStream(streamId, stream);
  }

  refreshStreamTtl(streamId: string, streamTTLSeconds: number | undefined): void {
    const deadline = ttlDeadline(streamTTLSeconds);
    if (deadline === undefined) {
      return;
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

  restoreLog(options: RestoreLogOptions<T>): Promise<RestoreLogOutcome> {
    const restore = () =>
      applyEventLogRestore({
        readPages: options.readPages,
        readTailEntryId: () => Promise.resolve(this.store.readTailEntryId(this.streamId)),
        installIfAbsent: async pages => {
          const events: T[] = [];
          for await (const page of pages) {
            events.push(...page);
          }
          return this.store.installIfAbsent({
            streamId: this.streamId,
            events,
            streamTTLSeconds: options.streamTTLSeconds,
          });
        },
        refreshTtl: () => {
          this.store.refreshStreamTtl(this.streamId, options.streamTTLSeconds);
          return Promise.resolve();
        },
      });
    // A live stream only refreshes its TTL. A missing one waits for a local slot,
    // and callers of this stream share that single rebuild.
    return shareRestore(`memory:${this.streamId}`, async () => {
      if (this.store.readTailEntryId(this.streamId) !== undefined) {
        return restore();
      }
      return withLocalRestoreBudget(restore);
    });
  }

  put(event: T, options?: EventSubscriptionPutOptions): Promise<void> {
    this.store.appendEvent({
      streamId: this.streamId,
      event,
      streamTTLSeconds: options?.streamTTLSeconds,
    });
    return Promise.resolve();
  }

  hasEventId(eventId: string): Promise<boolean> {
    return Promise.resolve(this.store.hasEventId({ streamId: this.streamId, eventId }));
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
