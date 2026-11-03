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
import { entryIdMilliseconds, eventIdSeekCursor, eventIdTimestampMs, isLegacySequenceEntryId } from './entryId';
import {
  applyEventLogRepair,
  eventIdFromStreamData,
  type AppendAfterTailResult,
  type RepairLogOptions,
  type StreamTail,
} from './repair';

const SUBSCRIBE_STREAM_POLL_ITEMS_COUNT = 100;
/** Delay between XREAD polls while a stream has no new events (a blocking XREAD would monopolize the shared connection). */
const SUBSCRIBE_STREAM_POLL_SLEEP_INTERVAL_MS = 1_000;

/**
 * Jump from ARGV[3], walk forward, return an exclusive XREAD cursor.
 * TS does the batch XREADs separately.
 *
 * KEYS[1]=stream  ARGV[1]=from|after  ARGV[2]=payload id  ARGV[3]=start  ARGV[4]=batch
 *
 * Returns {cursor, found}.
 * from → stop at the first match; return the prior entry (XREAD is exclusive).
 * after → walk the contiguous shared-id group (message + deltas); return its last entry.
 * missing → tip (live-only), found = 0.
 */
const SEEK_EVENT_ID_CURSOR = `
local mode, targetId, cursor, batch = ARGV[1], ARGV[2], ARGV[3], tonumber(ARGV[4])
local startBound = '(' .. cursor
local previous, lastMatch = nil, nil
while true do
  local entries = redis.call('XRANGE', KEYS[1], startBound, '+', 'COUNT', batch)
  if #entries == 0 then
    -- Start was past the tip (e.g. a future ULID ms): park at the real tip so
    -- XREAD still sees later live appends instead of waiting above them.
    if previous == nil then
      local tip = redis.call('XREVRANGE', KEYS[1], '+', '-', 'COUNT', 1)
      if tip[1] ~= nil then
        return {tip[1][1], 0}
      end
    end
    break
  end
  for i = 1, #entries do
    local entryId, fields = entries[i][1], entries[i][2]
    local data = nil
    for j = 1, #fields, 2 do
      if fields[j] == 'data' then data = fields[j + 1]; break end
    end
    local payloadId = nil
    if data ~= nil then
      local ok, obj = pcall(cjson.decode, data)
      if ok and type(obj) == 'table' and type(obj['id']) == 'string' then
        payloadId = obj['id']
      end
    end
    if mode == 'from' then
      if payloadId == targetId then
        return {previous or cursor, 1}
      end
    elseif payloadId == targetId then
      lastMatch = entryId
    elseif lastMatch ~= nil then
      return {lastMatch, 1}
    end
    previous = entryId
  end
  startBound = '(' .. entries[#entries][1]
  if #entries < batch then break end
end
if lastMatch ~= nil then
  return {lastMatch, 1}
end
return {previous or cursor, 0}
`;

/**
 * Live put. KEYS[1]=owner KEYS[2]=stream  ARGV[1]=executor ARGV[2]=ms ARGV[3]=payload ARGV[4]=ttl
 *
 * Rejects when another executor owns the stream. The entry id is `{ms}-*`, raised
 * to the tail millisecond when the event id is older than the tail (a delta of a
 * message whose id was minted before later events). Identical payloads are kept:
 * two deltas of the same message can carry the same text.
 */
const PUT_STREAM_ENTRY = `
local owner = redis.call('GET', KEYS[1])
if owner and owner ~= ARGV[1] then
  return 'owner_mismatch'
end
local ms = ARGV[2]
local tail = redis.call('XREVRANGE', KEYS[2], '+', '-', 'COUNT', 1)
if tail[1] ~= nil then
  local tailMs = string.match(tail[1][1], '^%d+')
  if tonumber(tailMs) > tonumber(ms) then
    ms = tailMs
  end
end
redis.call('XADD', KEYS[2], ms .. '-*', 'data', ARGV[3])
local ttl = tonumber(ARGV[4])
if ttl > 0 then
  redis.call('EXPIRE', KEYS[2], ttl)
  if owner then
    redis.call('EXPIRE', KEYS[1], ttl)
  end
end
return 'ok'
`;

/**
 * Repair backfill. KEYS[1]=stream  ARGV[1]=expected tail id ('' = empty) ARGV[2]=ttl
 * ARGV[3..]=ms, payload pairs.
 *
 * Appends only while the tail is still the one the suffix was computed from.
 * Returns {'ok', lastEntryId} or 'stale'. The caller uses lastEntryId as the
 * expected tail of the next page.
 */
const APPEND_AFTER_TAIL = `
local tail = redis.call('XREVRANGE', KEYS[1], '+', '-', 'COUNT', 1)
local tailId = ''
if tail[1] ~= nil then
  tailId = tail[1][1]
end
if tailId ~= ARGV[1] then
  return 'stale'
end
local tailMs = string.match(tailId, '^%d+') or '0'
local lastAdded = nil
for i = 3, #ARGV, 2 do
  local ms = ARGV[i]
  if tonumber(tailMs) > tonumber(ms) then
    ms = tailMs
  end
  lastAdded = redis.call('XADD', KEYS[1], ms .. '-*', 'data', ARGV[i + 1])
  tailMs = string.match(lastAdded, '^%d+')
end
local ttl = tonumber(ARGV[2])
if ttl > 0 then
  redis.call('EXPIRE', KEYS[1], ttl)
end
if lastAdded == nil then
  return 'stale'
end
return {'ok', lastAdded}
`;

function streamOwnerKey(streamId: string): string {
  return `${streamId}:owner`;
}

function ttlArgument(streamTTLSeconds: number | undefined): string {
  return String(streamTTLSeconds !== undefined && streamTTLSeconds > 0 ? streamTTLSeconds : 0);
}

function parseAppendReply(value: unknown, streamId: string): AppendAfterTailResult {
  if (value === 'stale') {
    return { status: 'stale' };
  }
  if (Array.isArray(value) && value.length === 2) {
    const status: unknown = value[0];
    const tailEntryId: unknown = value[1];
    if (status === 'ok' && typeof tailEntryId === 'string') {
      return { status: 'ok', tailEntryId };
    }
  }
  throw new Error(`Unexpected stream repair reply on ${streamId}`);
}

function parseSeekReply(value: unknown): { cursor: string; found: boolean } {
  if (Array.isArray(value) && value.length === 2) {
    const cursor: unknown = value[0];
    const found: unknown = value[1];
    if (typeof cursor === 'string' && (found === 0 || found === 1)) {
      return { cursor, found: found === 1 };
    }
  }
  throw new Error('Unexpected event-id seek reply');
}

/**
 * One Redis Stream. Entry ids are `{ulidMillisecond}-{n}` from `XADD`. The owner
 * key is separate from the stream so a deleted stream still rejects a stale producer.
 */
export class RedisEventSubscription<T extends { id: string }> implements EventSubscription<T> {
  constructor(
    private readonly redis: RedisClient,
    private readonly streamId: string,
  ) {}

  async repairLog(options: RepairLogOptions<T>): Promise<void> {
    const executorId = options.executorId;
    await applyEventLogRepair({
      readPages: options.readPages,
      claimOwner: executorId === undefined ? undefined : () => this.claimOwner(executorId, options.streamTTLSeconds),
      readTail: () => this.readTail(),
      appendAfterTail: batch => this.appendAfterTail({ ...batch, streamTTLSeconds: options.streamTTLSeconds }),
      refreshTtl: () => this.refreshTtl(options.streamTTLSeconds),
      refreshTtlOnUntouchedStream: executorId !== undefined,
    });
  }

  async put(event: T, options?: EventSubscriptionPutOptions): Promise<void> {
    const reply: unknown = await this.redis.eval(PUT_STREAM_ENTRY, {
      keys: [streamOwnerKey(this.streamId), this.streamId],
      arguments: [
        options?.executorId ?? '',
        this.entryMillisecondFor(event),
        JSON.stringify(event),
        ttlArgument(options?.streamTTLSeconds),
      ],
    });
    if (reply === 'owner_mismatch') {
      throw new StreamOwnerMismatchError(this.streamId);
    }
    if (reply !== 'ok') {
      throw new Error(`Unexpected stream put reply on ${this.streamId}`);
    }
  }

  async hasEventId(eventId: string): Promise<boolean> {
    const { found } = await this.seekEventIdCursor({ mode: 'from', eventId });
    return found;
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

  /**
   * One Lua seek for the XREAD cursor, then the same forever-poll as sequence
   * resume. Seek and batch reads are separate Redis round-trips on purpose.
   */
  private async *pollByEventId(
    options: EventSubscriptionPollOptions,
  ): AsyncGenerator<SequencedEvent<T>, void, unknown> {
    const fromEventId = options.fromEventId;
    const afterEventId = options.afterEventId;
    const eventId = fromEventId ?? afterEventId;
    if (eventId === undefined) {
      throw new Error('Pass fromEventId or afterEventId');
    }
    const mode = fromEventId !== undefined ? 'from' : 'after';
    const signal = options.signal;
    let { cursor } = await this.seekEventIdCursor({ mode, eventId });
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
        const event = this.readEvent(id, message);
        // after: drop live rows that reuse the seek id (another delta).
        if (mode === 'after' && event.id === eventId) {
          continue;
        }
        yield event;
      }
    }
  }

  /**
   * Jump near the ULID millisecond (or stream start), walk forward in Lua until
   * the payload id, return exclusive XREAD cursor. See SEEK_EVENT_ID_CURSOR.
   */
  private async seekEventIdCursor(input: {
    mode: 'from' | 'after';
    eventId: string;
  }): Promise<{ cursor: string; found: boolean }> {
    const startCursor = eventIdSeekCursor({
      eventId: input.eventId,
      firstEntryId: await this.firstEntryId(),
    });
    const reply: unknown = await this.redis.eval(SEEK_EVENT_ID_CURSOR, {
      keys: [this.streamId],
      arguments: [input.mode, input.eventId, startCursor, String(SUBSCRIBE_STREAM_POLL_ITEMS_COUNT)],
    });
    return parseSeekReply(reply);
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
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      'id' in value &&
      typeof value.id === 'string'
    );
  }

  private async readTail(): Promise<StreamTail | undefined> {
    const entries = await this.redis.xRevRange(this.streamId, '+', '-', { COUNT: 1 });
    const latest = entries[0];
    if (!latest) {
      return undefined;
    }
    const data = latest.message['data'];
    if (data === undefined) {
      throw new Error(`Corrupt stream entry ${latest.id} on ${this.streamId}: missing data field`);
    }
    const eventId = eventIdFromStreamData(data);
    if (eventId === undefined) {
      throw new Error(`Corrupt stream entry ${latest.id} on ${this.streamId}: missing event id`);
    }
    return { entryId: latest.id, eventId, payload: data };
  }

  private async claimOwner(executorId: string, streamTTLSeconds: number | undefined): Promise<void> {
    const key = streamOwnerKey(this.streamId);
    const multi = this.redis.multi().set(key, executorId);
    if (streamTTLSeconds !== undefined && streamTTLSeconds > 0) {
      multi.expire(key, streamTTLSeconds);
    }
    await multi.exec();
  }

  /** The owner key shares the stream lifetime so it does not outlive an idle turn. */
  private async refreshTtl(streamTTLSeconds: number | undefined): Promise<void> {
    if (streamTTLSeconds !== undefined && streamTTLSeconds > 0) {
      await this.redis
        .multi()
        .expire(this.streamId, streamTTLSeconds)
        .expire(streamOwnerKey(this.streamId), streamTTLSeconds)
        .exec();
    }
  }

  private async appendAfterTail(input: {
    tailEntryId: string | undefined;
    events: T[];
    streamTTLSeconds: number | undefined;
  }): Promise<AppendAfterTailResult> {
    const pairs = input.events.flatMap(event => [this.entryMillisecondFor(event), JSON.stringify(event)]);
    const reply: unknown = await this.redis.eval(APPEND_AFTER_TAIL, {
      keys: [this.streamId],
      arguments: [input.tailEntryId ?? '', ttlArgument(input.streamTTLSeconds), ...pairs],
    });
    return parseAppendReply(reply, this.streamId);
  }

  private entryMillisecondFor(event: T): string {
    return String(eventIdTimestampMs(event.id) ?? Date.now());
  }
}
