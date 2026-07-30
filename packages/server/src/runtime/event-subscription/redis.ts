import type { RedisClientType } from 'redis';
import {
  StreamCorruptEntryError,
  StreamExpiringError,
  StreamGoneError,
  type EventSubscription,
  type EventSubscriptionPutOptions,
  type SequencedEvent,
} from '.';

const SUBSCRIBE_STREAM_THRESHOLD_MS = 60 * 1_000;
const SUBSCRIBE_STREAM_POLL_ITEMS_COUNT = 100;
const SUBSCRIBE_STREAM_POLL_SLEEP_INTERVAL_MS = 1_000;

interface StreamSequenceState {
  nextSequenceNumber: number;
  cleanupTimer?: NodeJS.Timeout | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sequenceNumberFromEntryId(streamId: string, entryId: string): number {
  const separator = entryId.indexOf('-');
  const raw = separator === -1 ? entryId : entryId.slice(0, separator);
  const sequenceNumber = Number(raw);
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 0) {
    throw new StreamCorruptEntryError(streamId, entryId, 'invalid sequence number');
  }
  return sequenceNumber;
}

export class RedisEventSubscription<T extends object> implements EventSubscription<T> {
  private readonly streamSequences = new Map<string, StreamSequenceState>();

  constructor(
    private readonly redis: RedisClientType,
    private readonly parseEvent: (raw: unknown) => T,
  ) {}

  async put(streamId: string, event: T, options?: EventSubscriptionPutOptions): Promise<number> {
    const state = this.streamSequences.get(streamId) ?? { nextSequenceNumber: 0 };
    this.streamSequences.set(streamId, state);
    const sequenceNumber = state.nextSequenceNumber;
    state.nextSequenceNumber += 1;

    const sequencedEvent: SequencedEvent<T> = { ...event, sequence_number: sequenceNumber };
    const multi = this.redis.multi().xAdd(streamId, `${String(sequenceNumber)}-1`, {
      data: JSON.stringify(sequencedEvent),
    });
    if (options?.streamTTLSeconds && options.streamTTLSeconds > 0) {
      multi.expire(streamId, options.streamTTLSeconds);
    }
    await multi.exec();

    if (options?.streamTTLSeconds && options.streamTTLSeconds > 0) {
      this.scheduleSequenceCleanup(streamId, state, options.streamTTLSeconds);
    }
    return sequenceNumber;
  }

  async *poll(streamId: string, afterSequenceNumber?: number): AsyncGenerator<SequencedEvent<T>, void, unknown> {
    const expiresAtMs = await this.redis.pExpireTime(streamId);
    if (expiresAtMs === -2) {
      throw new StreamGoneError(streamId);
    }
    if (expiresAtMs >= 0 && expiresAtMs - Date.now() < SUBSCRIBE_STREAM_THRESHOLD_MS) {
      throw new StreamExpiringError(streamId, expiresAtMs);
    }

    let cursor = afterSequenceNumber === undefined ? '0-0' : `${String(afterSequenceNumber + 1)}-0`;
    for (;;) {
      if ((await this.redis.exists(streamId)) === 0) {
        throw new StreamGoneError(streamId);
      }
      const reply = await this.redis.xRead([{ key: streamId, id: cursor }], {
        COUNT: SUBSCRIBE_STREAM_POLL_ITEMS_COUNT,
      });
      const messages = reply?.[0]?.messages ?? [];
      if (messages.length === 0) {
        await sleep(SUBSCRIBE_STREAM_POLL_SLEEP_INTERVAL_MS);
        continue;
      }

      for (const { id, message } of messages) {
        cursor = id;
        const data = message['data'];
        if (data === undefined) {
          throw new StreamCorruptEntryError(streamId, id, 'missing data field');
        }

        let raw: unknown;
        try {
          raw = JSON.parse(data);
        } catch (error) {
          throw new StreamCorruptEntryError(streamId, id, 'data is not valid JSON', { cause: error });
        }

        let event: T;
        try {
          event = this.parseEvent(raw);
        } catch (error) {
          throw new StreamCorruptEntryError(streamId, id, 'data has an invalid event shape', { cause: error });
        }
        yield { ...event, sequence_number: sequenceNumberFromEntryId(streamId, id) };
      }
    }
  }

  private scheduleSequenceCleanup(streamId: string, state: StreamSequenceState, ttlSeconds: number): void {
    if (state.cleanupTimer) {
      clearTimeout(state.cleanupTimer);
    }
    state.cleanupTimer = setTimeout(() => {
      if (this.streamSequences.get(streamId) === state) {
        this.streamSequences.delete(streamId);
      }
    }, ttlSeconds * 1_000);
    state.cleanupTimer.unref();
  }
}
