import type { RedisClient } from '@truefoundry/trueforge-core/request-reply';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  StreamGoneError,
  StreamOwnerMismatchError,
  SUBSCRIBE_STREAM_THRESHOLD_MS,
  type EventSubscription,
  type EventSubscriptionPollOptions,
  type EventSubscriptionPutOptions,
  type SequencedEvent,
} from '.';
import { applyEventLogRepair, eventIdFromStreamData, eventIdOf, type RepairLogOptions } from './repair';

const SUBSCRIBE_STREAM_POLL_ITEMS_COUNT = 100;
/** Delay between XREAD polls while a stream has no new events (a blocking XREAD would monopolize the shared connection). */
const SUBSCRIBE_STREAM_POLL_SLEEP_INTERVAL_MS = 1_000;

/**
 * One script for put and for suffix backfill. Put checks the stream-owner key.
 * Repair passes check-owner 0 so a subscribe can append without claiming.
 * An explicit id at or below the tail is a conflict; the caller treats it as a
 * no-op when that tail already holds the same event id.
 */
const APPEND_STREAM_ENTRY = `
local checkOwner = ARGV[1]
if checkOwner == '1' then
  local owner = redis.call('GET', KEYS[1])
  if owner ~= false and owner ~= ARGV[2] then
    return {'owner_mismatch', ''}
  end
end
local added = redis.pcall('XADD', KEYS[2], ARGV[3], 'data', ARGV[4])
if type(added) == 'table' and added['err'] ~= nil then
  local err = added['err']
  if string.find(err, 'equal or smaller', 1, true) then
    local tail = redis.call('XREVRANGE', KEYS[2], '+', '-', 'COUNT', 1)
    local data = ''
    if tail[1] ~= nil then
      local fields = tail[1][2]
      for i = 1, #fields, 2 do
        if fields[i] == 'data' then
          data = fields[i + 1]
          break
        end
      end
    end
    return {'conflict', data}
  end
  return {'error', err}
end
local ttl = tonumber(ARGV[5])
if ttl ~= nil and ttl > 0 then
  redis.call('EXPIRE', KEYS[2], ttl)
end
return {'ok', ''}
`;

function sequenceNumberFromEntryId(streamId: string, entryId: string): number {
  const separator = entryId.indexOf('-');
  const raw = separator === -1 ? entryId : entryId.slice(0, separator);
  const sequenceNumber = Number(raw);
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 0) {
    throw new Error(`Corrupt stream entry ${entryId} on ${streamId}: invalid sequence number`);
  }
  return sequenceNumber;
}

function streamOwnerKey(streamId: string): string {
  return `${streamId}:owner`;
}

type AppendStatus = 'ok' | 'conflict' | 'owner_mismatch' | 'error';

function isAppendStatus(value: unknown): value is AppendStatus {
  return value === 'ok' || value === 'conflict' || value === 'owner_mismatch' || value === 'error';
}

function parseAppendReply(value: unknown): { status: AppendStatus; detail: string } {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('Unexpected stream append reply');
  }
  const status: unknown = Object.prototype.hasOwnProperty.call(value, 0) ? Reflect.get(value, 0) : undefined;
  const detail: unknown = Object.prototype.hasOwnProperty.call(value, 1) ? Reflect.get(value, 1) : undefined;
  if (isAppendStatus(status) && typeof detail === 'string') {
    return { status, detail };
  }
  throw new Error('Unexpected stream append reply');
}

/**
 * One Redis Stream. Sequence numbers are explicit ids (`n-1`). The owner key is
 * separate from the stream so a missing stream still rejects a stale producer.
 */
export class RedisEventSubscription<T extends object> implements EventSubscription<T> {
  private nextSequenceNumber = 1;

  constructor(
    private readonly redis: RedisClient,
    private readonly streamId: string,
  ) {}

  async repairLog(options: RepairLogOptions<T>): Promise<void> {
    const executorId = options.executorId;
    this.nextSequenceNumber = await applyEventLogRepair({
      entries: options.entries,
      persistSequences: options.persistSequences,
      claimOwner:
        executorId === undefined
          ? undefined
          : () => this.redis.set(streamOwnerKey(this.streamId), executorId).then(() => undefined),
      readTail: () => this.readTail(),
      append: async entry => {
        const reply = await this.appendEntry({
          sequenceNumber: entry.sequence_number,
          payload: JSON.stringify({ ...entry.event, sequence_number: entry.sequence_number }),
          checkOwner: false,
          executorId: '',
          streamTTLSeconds: options.streamTTLSeconds,
        });
        return this.outcomeForEvent({ reply, eventId: entry.id, sequenceNumber: entry.sequence_number });
      },
      refreshTtl: () => this.refreshTtl(options.streamTTLSeconds),
      refreshTtlOnUntouchedStream: executorId !== undefined,
    });
  }

  async put(event: T, options?: EventSubscriptionPutOptions): Promise<number> {
    const sequenceNumber = this.nextSequenceNumber;
    this.nextSequenceNumber += 1;
    const reply = await this.appendEntry({
      sequenceNumber,
      payload: JSON.stringify({ ...event, sequence_number: sequenceNumber }),
      checkOwner: true,
      executorId: options?.executorId ?? '',
      streamTTLSeconds: options?.streamTTLSeconds,
    });
    if (reply.status === 'owner_mismatch') {
      throw new StreamOwnerMismatchError(this.streamId);
    }
    await this.outcomeForEvent({ reply, eventId: eventIdOf(event), sequenceNumber });
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

  private async readTail(): Promise<{ eventId: string; sequenceNumber: number } | undefined> {
    const entries = await this.redis.xRevRange(this.streamId, '+', '-', { COUNT: 1 });
    const latest = entries[0];
    if (!latest) {
      return undefined;
    }
    const data = latest.message['data'];
    if (data === undefined) {
      throw new Error(`Corrupt stream entry ${latest.id} on ${this.streamId}: missing data field`);
    }
    return {
      eventId: eventIdFromStreamData(data) ?? '',
      sequenceNumber: sequenceNumberFromEntryId(this.streamId, latest.id),
    };
  }

  private async refreshTtl(streamTTLSeconds: number | undefined): Promise<void> {
    if (streamTTLSeconds !== undefined && streamTTLSeconds > 0) {
      await this.redis.expire(this.streamId, streamTTLSeconds);
    }
  }

  private async appendEntry(input: {
    sequenceNumber: number;
    payload: string;
    checkOwner: boolean;
    executorId: string;
    streamTTLSeconds: number | undefined;
  }): Promise<{ status: AppendStatus; detail: string }> {
    const ttl = input.streamTTLSeconds !== undefined && input.streamTTLSeconds > 0 ? input.streamTTLSeconds : 0;
    const reply: unknown = await this.redis.eval(APPEND_STREAM_ENTRY, {
      keys: [streamOwnerKey(this.streamId), this.streamId],
      arguments: [
        input.checkOwner ? '1' : '0',
        input.executorId,
        `${String(input.sequenceNumber)}-1`,
        input.payload,
        String(ttl),
      ],
    });
    return parseAppendReply(reply);
  }

  private outcomeForEvent(input: {
    reply: { status: AppendStatus; detail: string };
    eventId: string | undefined;
    sequenceNumber: number;
  }): Promise<'appended' | 'duplicate'> {
    if (input.reply.status === 'ok') {
      return Promise.resolve('appended');
    }
    if (input.reply.status === 'owner_mismatch') {
      return Promise.reject(new StreamOwnerMismatchError(this.streamId));
    }
    if (input.reply.status === 'error') {
      return Promise.reject(new Error(`Redis stream append failed on ${this.streamId}: ${input.reply.detail}`));
    }
    const tailId = eventIdFromStreamData(input.reply.detail);
    if (tailId !== undefined && input.eventId !== undefined && tailId === input.eventId) {
      return Promise.resolve('duplicate');
    }
    return Promise.reject(
      new Error(
        `explicit stream id ${String(input.sequenceNumber)} conflicts on ${this.streamId} and the tail event is ${tailId ?? 'missing'}`,
      ),
    );
  }
}
