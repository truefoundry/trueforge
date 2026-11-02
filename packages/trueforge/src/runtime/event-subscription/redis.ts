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
import {
  entryIdMilliseconds,
  EventIdSeek,
  eventIdSeekCursor,
  eventIdTimestampMs,
  isLegacySequenceEntryId,
} from './entryId';
import { applyEventLogRepair, eventIdFromStreamData, eventIdOf, type RepairLogOptions } from './repair';

const SUBSCRIBE_STREAM_POLL_ITEMS_COUNT = 100;
/** Delay between XREAD polls while a stream has no new events (a blocking XREAD would monopolize the shared connection). */
const SUBSCRIBE_STREAM_POLL_SLEEP_INTERVAL_MS = 1_000;

/**
 * One script for put and for suffix backfill. Put checks the stream-owner key.
 * Repair passes check-owner 0 so a subscribe can append without claiming.
 * The id is `{millisecond}-*`. Redis 7 assigns the counter. The same payload
 * already at the tail is a duplicate. A millisecond older than the tail is a
 * conflict; the caller retries with the tail millisecond.
 */
const APPEND_STREAM_ENTRY = `
local checkOwner = ARGV[1]
if checkOwner == '1' then
  local owner = redis.call('GET', KEYS[1])
  if owner ~= false and owner ~= ARGV[2] then
    return {'owner_mismatch', ''}
  end
end
local tail = redis.call('XREVRANGE', KEYS[2], '+', '-', 'COUNT', 1)
if tail[1] ~= nil then
  local fields = tail[1][2]
  for i = 1, #fields, 2 do
    if fields[i] == 'data' and fields[i + 1] == ARGV[4] then
      return {'duplicate', ''}
    end
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

function streamOwnerKey(streamId: string): string {
  return `${streamId}:owner`;
}

type AppendStatus = 'ok' | 'duplicate' | 'conflict' | 'owner_mismatch' | 'error';

function isAppendStatus(value: unknown): value is AppendStatus {
  return (
    value === 'ok' || value === 'duplicate' || value === 'conflict' || value === 'owner_mismatch' || value === 'error'
  );
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
 * One Redis Stream. Entry ids are `{ulidMillisecond}-{n}` from `XADD`. The owner
 * key is separate from the stream so a missing stream still rejects a stale producer.
 */
export class RedisEventSubscription<T extends object> implements EventSubscription<T> {
  constructor(
    private readonly redis: RedisClient,
    private readonly streamId: string,
  ) {}

  async repairLog(options: RepairLogOptions<T>): Promise<void> {
    const executorId = options.executorId;
    await applyEventLogRepair({
      entries: options.entries,
      claimOwner:
        executorId === undefined
          ? undefined
          : () => this.redis.set(streamOwnerKey(this.streamId), executorId).then(() => undefined),
      readTail: () => this.readTail(),
      append: entry =>
        this.appendEvent({
          event: entry.event,
          checkOwner: false,
          executorId: '',
          streamTTLSeconds: options.streamTTLSeconds,
        }),
      refreshTtl: () => this.refreshTtl(options.streamTTLSeconds),
      refreshTtlOnUntouchedStream: executorId !== undefined,
    });
  }

  async put(event: T, options?: EventSubscriptionPutOptions): Promise<void> {
    await this.appendEvent({
      event,
      checkOwner: true,
      executorId: options?.executorId ?? '',
      streamTTLSeconds: options?.streamTTLSeconds,
    });
  }

  async firstEntryId(): Promise<string | undefined> {
    const entries = await this.redis.xRange(this.streamId, '-', '+', { COUNT: 1 });
    return entries[0]?.id;
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
    if (options?.fromEventId !== undefined || options?.afterEventId !== undefined) {
      yield* this.pollByEventId(options);
      return;
    }
    const signal = options?.signal;
    // 0 and omitted both mean "from the start" (sequences are 1-indexed).
    // Entries are `${seq}-1`. XREAD returns IDs greater than `id`, so
    // `${N+1}-0` is an exclusive lower bound just below the next entry.
    let cursor =
      afterSequenceNumber === undefined || afterSequenceNumber === 0 ? '1-0' : `${String(afterSequenceNumber + 1)}-0`;
    for (;;) {
      const messages = await this.readAfter(cursor, signal);
      if (messages === undefined) {
        return;
      }
      if (messages.length === 0) {
        if (!(await this.waitForEntries(signal))) {
          return;
        }
        continue;
      }

      for (const { id, message } of messages) {
        cursor = id;
        yield this.readEvent(id, message);
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
    let cursor = eventIdSeekCursor({ eventId, firstEntryId: await this.firstEntryId() });
    let scanning = true;
    for (;;) {
      const messages = await this.readAfter(cursor, signal);
      if (messages === undefined) {
        return;
      }
      if (messages.length === 0) {
        if (scanning) {
          scanning = false;
          for (const event of seek.caughtUp()) {
            yield event;
          }
        }
        if (!(await this.waitForEntries(signal))) {
          return;
        }
        continue;
      }
      for (const { id, message } of messages) {
        cursor = id;
        const event = this.eventWithId(this.readEvent(id, message), id);
        for (const item of seek.push(event)) {
          yield item;
        }
      }
    }
  }

  private async readAfter(
    cursor: string,
    signal: AbortSignal | undefined,
  ): Promise<{ id: string; message: Record<string, string> }[] | undefined> {
    if (signal?.aborted) {
      return undefined;
    }
    if ((await this.redis.exists(this.streamId)) === 0) {
      throw new StreamGoneError(this.streamId);
    }
    const reply = await this.redis.xRead([{ key: this.streamId, id: cursor }], {
      COUNT: SUBSCRIBE_STREAM_POLL_ITEMS_COUNT,
    });
    return reply?.[0]?.messages ?? [];
  }

  private async waitForEntries(signal: AbortSignal | undefined): Promise<boolean> {
    try {
      await sleep(SUBSCRIBE_STREAM_POLL_SLEEP_INTERVAL_MS, undefined, { signal });
    } catch (error) {
      if (signal?.aborted) {
        return false;
      }
      throw error;
    }
    return true;
  }

  private readEvent(id: string, message: Record<string, string>): SequencedEvent<T> {
    const data = message['data'];
    if (data === undefined) {
      throw new Error(`Corrupt stream entry ${id} on ${this.streamId}: missing data field`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      throw new Error(`Corrupt stream entry ${id} on ${this.streamId}: data is not valid JSON`, { cause: error });
    }
    if (!this.isStoredEvent(parsed)) {
      throw new Error(`Corrupt stream entry ${id} on ${this.streamId}: data is not an event`);
    }
    if (!isLegacySequenceEntryId(id)) {
      if (Object.hasOwn(parsed, 'sequence_number')) {
        const copy: T = { ...parsed };
        Reflect.deleteProperty(copy, 'sequence_number');
        return copy;
      }
      return parsed;
    }
    return { ...parsed, sequence_number: entryIdMilliseconds(id) };
  }

  private isStoredEvent(value: unknown): value is T {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private eventWithId(event: SequencedEvent<T>, entryId: string): SequencedEvent<T> & { id: string } {
    const eventId = eventIdOf(event);
    if (eventId === undefined) {
      throw new Error(`Corrupt stream entry ${entryId} on ${this.streamId}: missing event id`);
    }
    return { ...event, id: eventId };
  }

  private async readTail(): Promise<{ eventId: string; payload: string } | undefined> {
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
      payload: data,
    };
  }

  private async lastEntryId(): Promise<string | undefined> {
    const entries = await this.redis.xRevRange(this.streamId, '+', '-', { COUNT: 1 });
    return entries[0]?.id;
  }

  private async refreshTtl(streamTTLSeconds: number | undefined): Promise<void> {
    if (streamTTLSeconds !== undefined && streamTTLSeconds > 0) {
      await this.redis.expire(this.streamId, streamTTLSeconds);
    }
  }

  private async appendEvent(input: {
    event: T;
    checkOwner: boolean;
    executorId: string;
    streamTTLSeconds: number | undefined;
  }): Promise<'appended' | 'duplicate'> {
    const payload = JSON.stringify(input.event);
    const reply = await this.appendEntry({
      streamId: this.streamIdFor(input.event),
      payload,
      checkOwner: input.checkOwner,
      executorId: input.executorId,
      streamTTLSeconds: input.streamTTLSeconds,
    });
    if (reply.status === 'ok') {
      return 'appended';
    }
    if (reply.status === 'duplicate') {
      return 'duplicate';
    }
    if (reply.status === 'owner_mismatch') {
      throw new StreamOwnerMismatchError(this.streamId);
    }
    if (reply.status === 'error') {
      throw new Error(`Redis stream append failed on ${this.streamId}: ${reply.detail}`);
    }
    // The tail id can match a delta of the same message. Identical payloads
    // already returned `duplicate` above; a distinct payload must be retried
    // at the tail millisecond.
    const lastId = await this.lastEntryId();
    if (lastId === undefined) {
      throw new Error(`Redis stream append conflicted on an empty stream ${this.streamId}`);
    }
    let retry: { status: AppendStatus; detail: string };
    try {
      retry = await this.appendEntry({
        streamId: `${String(entryIdMilliseconds(lastId))}-*`,
        payload,
        checkOwner: input.checkOwner,
        executorId: input.executorId,
        streamTTLSeconds: input.streamTTLSeconds,
      });
    } catch (error) {
      throw new Error(`Failed to append event on ${this.streamId}`, { cause: error });
    }
    if (retry.status === 'ok') {
      return 'appended';
    }
    if (retry.status === 'duplicate') {
      return 'duplicate';
    }
    if (retry.status === 'owner_mismatch') {
      throw new StreamOwnerMismatchError(this.streamId);
    }
    throw new Error(`Redis stream append failed on ${this.streamId}: ${retry.detail}`, { cause: reply.detail });
  }

  private streamIdFor(event: T): string {
    const eventId = eventIdOf(event);
    const timestamp = eventId === undefined ? undefined : eventIdTimestampMs(eventId);
    return `${String(timestamp ?? Date.now())}-*`;
  }

  private async appendEntry(input: {
    streamId: string;
    payload: string;
    checkOwner: boolean;
    executorId: string;
    streamTTLSeconds: number | undefined;
  }): Promise<{ status: AppendStatus; detail: string }> {
    const ttl = input.streamTTLSeconds !== undefined && input.streamTTLSeconds > 0 ? input.streamTTLSeconds : 0;
    const reply: unknown = await this.redis.eval(APPEND_STREAM_ENTRY, {
      keys: [streamOwnerKey(this.streamId), this.streamId],
      arguments: [input.checkOwner ? '1' : '0', input.executorId, input.streamId, input.payload, String(ttl)],
    });
    return parseAppendReply(reply);
  }
}
