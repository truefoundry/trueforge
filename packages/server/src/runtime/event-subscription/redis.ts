import { setTimeout as sleep } from 'node:timers/promises';
import type { RedisClientType } from 'redis';
import {
  StreamGoneError,
  SUBSCRIBE_STREAM_THRESHOLD_MS,
  type EventSubscription,
  type EventSubscriptionPollOptions,
  type EventSubscriptionPutOptions,
  type SequencedEvent,
} from '.';

const SUBSCRIBE_STREAM_POLL_ITEMS_COUNT = 100;
/** Delay between XREAD polls while a stream has no new events (a blocking XREAD would monopolize the shared connection). */
const SUBSCRIBE_STREAM_POLL_SLEEP_INTERVAL_MS = 1_000;

function sequenceNumberFromEntryId(streamId: string, entryId: string): number {
  const separator = entryId.indexOf('-');
  const raw = separator === -1 ? entryId : entryId.slice(0, separator);
  const sequenceNumber = Number(raw);
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 0) {
    throw new Error(`Corrupt stream entry ${entryId} on ${streamId}: invalid sequence number`);
  }
  return sequenceNumber;
}

/**
 * One Redis Stream with locally minted 1-indexed sequence numbers. Assumes a
 * single producer per stream; the counter dies with the instance, the data via key TTL.
 */
export class RedisEventSubscription<T extends object> implements EventSubscription<T> {
  private nextSequenceNumber = 1;

  constructor(
    private readonly redis: RedisClientType,
    private readonly streamId: string,
  ) {}

  async put(event: T, options?: EventSubscriptionPutOptions): Promise<number> {
    const sequenceNumber = this.nextSequenceNumber;
    this.nextSequenceNumber += 1;

    const sequencedEvent: SequencedEvent<T> = { ...event, sequence_number: sequenceNumber };
    const multi = this.redis.multi().xAdd(this.streamId, `${String(sequenceNumber)}-1`, {
      data: JSON.stringify(sequencedEvent),
    });
    if (options?.streamTTLSeconds && options.streamTTLSeconds > 0) {
      multi.expire(this.streamId, options.streamTTLSeconds);
    }
    await multi.exec();
    return sequenceNumber;
  }

  async assertSubscribable(): Promise<void> {
    const expiresAtMs = await this.redis.pExpireTime(this.streamId);
    if (expiresAtMs === -2) {
      throw new StreamGoneError(this.streamId);
    }
    // Expiring within the threshold is treated as already gone: too little
    // time remains for a subscription to be useful.
    if (expiresAtMs >= 0 && expiresAtMs - Date.now() < SUBSCRIBE_STREAM_THRESHOLD_MS) {
      throw new StreamGoneError(this.streamId);
    }
  }

  async *poll(
    afterSequenceNumber?: number,
    options?: EventSubscriptionPollOptions,
  ): AsyncGenerator<SequencedEvent<T>, void, unknown> {
    const signal = options?.signal;
    // 0 and omitted both mean "from the start" (sequences are 1-indexed).
    // Entries are `${seq}-1`. XREAD returns IDs greater than `id`, so
    // `${N+1}-0` is an exclusive lower bound just below the next entry.
    let cursor =
      afterSequenceNumber === undefined || afterSequenceNumber === 0 ? '1-0' : `${String(afterSequenceNumber + 1)}-0`;
    for (;;) {
      if (signal?.aborted) {
        return;
      }
      if ((await this.redis.exists(this.streamId)) === 0) {
        throw new StreamGoneError(this.streamId);
      }
      const reply = await this.redis.xRead([{ key: this.streamId, id: cursor }], {
        COUNT: SUBSCRIBE_STREAM_POLL_ITEMS_COUNT,
      });
      const messages = reply?.[0]?.messages ?? [];
      if (messages.length === 0) {
        try {
          await sleep(SUBSCRIBE_STREAM_POLL_SLEEP_INTERVAL_MS, undefined, { signal });
        } catch (error) {
          if (signal?.aborted) {
            return;
          }
          throw error;
        }
        continue;
      }

      for (const { id, message } of messages) {
        cursor = id;
        const data = message['data'];
        if (data === undefined) {
          throw new Error(`Corrupt stream entry ${id} on ${this.streamId}: missing data field`);
        }

        let event: T;
        try {
          // Own writes read back; trusted without validation, as in the gateway.
          event = JSON.parse(data) as T;
        } catch (error) {
          throw new Error(`Corrupt stream entry ${id} on ${this.streamId}: data is not valid JSON`, {
            cause: error,
          });
        }
        yield { ...event, sequence_number: sequenceNumberFromEntryId(this.streamId, id) };
      }
    }
  }
}
