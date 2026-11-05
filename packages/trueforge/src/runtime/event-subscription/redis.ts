import type { RedisClient } from '@truefoundry/trueforge-core/request-reply';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  StreamGoneError,
  SUBSCRIBE_STREAM_THRESHOLD_MS,
  type EventSubscription,
  type EventSubscriptionPollOptions,
  type EventSubscriptionPutOptions,
  type SequencedEvent,
} from '.';
import { entryIdMilliseconds, eventIdSeekCursor, eventIdTimestampMs, isLegacySequenceEntryId } from './entryId';
import { applyEventLogRestore, type AppendAfterTailResult, type RestoreLogOptions } from './restore';

const SUBSCRIBE_STREAM_POLL_ITEMS_COUNT = 100;
/** Delay between XREAD polls while a stream has no new events (a blocking XREAD would monopolize the shared connection). */
const SUBSCRIBE_STREAM_POLL_SLEEP_INTERVAL_MS = 1_000;

/**
 * One bounded step of an event-id seek. The TS side loops, so Redis serves
 * other clients between batches.
 *
 * KEYS[1]=stream  ARGV[1]=from|after  ARGV[2]=payload id  ARGV[3]=exclusive start
 * ARGV[4]=batch  ARGV[5]=last match so far ('' = none)  ARGV[6]='1' on the first step
 *
 * Returns {state, cursor, lastMatch}. `cursor` is an exclusive XREAD cursor.
 * more → keep going from `cursor` carrying `lastMatch`.
 * found → from: the entry before the first match. after: the last entry with the id.
 * missing → the last entry seen (live-only resume).
 */
const SEEK_EVENT_ID_STEP = `
local mode, targetId, cursor, batch = ARGV[1], ARGV[2], ARGV[3], tonumber(ARGV[4])
local lastMatch = ARGV[5]
local entries = redis.call('XRANGE', KEYS[1], '(' .. cursor, '+', 'COUNT', batch)
if #entries == 0 then
  if ARGV[6] == '1' then
    -- Start was past the tip (e.g. a future ULID ms): park at the real tip so
    -- XREAD still sees later live appends instead of waiting above them.
    local tip = redis.call('XREVRANGE', KEYS[1], '+', '-', 'COUNT', 1)
    if tip[1] ~= nil then
      return {'missing', tip[1][1], ''}
    end
  end
  if lastMatch ~= '' then
    return {'found', lastMatch, ''}
  end
  return {'missing', cursor, ''}
end
local previous = cursor
for i = 1, #entries do
  local entryId, fields = entries[i][1], entries[i][2]
  local payloadId, data = nil, nil
  for j = 1, #fields, 2 do
    if fields[j] == 'id' then payloadId = fields[j + 1]; break end
    if fields[j] == 'data' then data = fields[j + 1] end
  end
  -- Old entries have no id field; decoding is limited to those.
  if payloadId == nil and data ~= nil then
    local ok, obj = pcall(cjson.decode, data)
    if ok and type(obj) == 'table' and type(obj['id']) == 'string' then
      payloadId = obj['id']
    end
  end
  if payloadId == targetId then
    if mode == 'from' then
      return {'found', previous, ''}
    end
    lastMatch = entryId
  end
  previous = entryId
end
if #entries < batch then
  if lastMatch ~= '' then
    return {'found', lastMatch, ''}
  end
  return {'missing', previous, ''}
end
return {'more', previous, lastMatch}
`;

/**
 * Live put. KEYS[1]=stream  ARGV[1]=ms ARGV[2]=event id ARGV[3]=payload ARGV[4]=ttl
 *
 * The entry id is `{ms}-*`, raised to the tail millisecond when the event id is
 * older than the tail (a delta of a message whose id was minted before later
 * events); XADD rejects a smaller id. Identical payloads are kept: two deltas of
 * the same message can carry the same text. The event id is its own field so a
 * seek compares strings instead of decoding payloads on the Redis thread.
 */
const PUT_STREAM_ENTRY = `
local ms = ARGV[1]
local tail = redis.call('XREVRANGE', KEYS[1], '+', '-', 'COUNT', 1)
if tail[1] ~= nil then
  local tailMs = string.match(tail[1][1], '^%d+')
  if tonumber(tailMs) > tonumber(ms) then
    ms = tailMs
  end
end
redis.call('XADD', KEYS[1], ms .. '-*', 'id', ARGV[2], 'data', ARGV[3])
local ttl = tonumber(ARGV[4])
if ttl > 0 then
  redis.call('EXPIRE', KEYS[1], ttl)
end
return 'ok'
`;

/**
 * Restore append. KEYS[1]=stream  ARGV[1]=expected tail id ('' = empty) ARGV[2]=ttl
 * ARGV[3..]=ms, event id, payload triples.
 *
 * Appends only while the tail is still the expected one.
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
for i = 3, #ARGV, 3 do
  local ms = ARGV[i]
  if tonumber(tailMs) > tonumber(ms) then
    ms = tailMs
  end
  lastAdded = redis.call('XADD', KEYS[1], ms .. '-*', 'id', ARGV[i + 1], 'data', ARGV[i + 2])
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
  throw new Error(`Unexpected stream restore reply on ${streamId}`);
}

interface SeekStep {
  state: 'more' | 'found' | 'missing';
  cursor: string;
  lastMatch: string;
}

function parseSeekReply(value: unknown): SeekStep {
  if (Array.isArray(value) && value.length === 3) {
    const state: unknown = value[0];
    const cursor: unknown = value[1];
    const lastMatch: unknown = value[2];
    if (
      (state === 'more' || state === 'found' || state === 'missing') &&
      typeof cursor === 'string' &&
      typeof lastMatch === 'string'
    ) {
      return { state, cursor, lastMatch };
    }
  }
  throw new Error('Unexpected event-id seek reply');
}

/** One Redis Stream. Entry ids are `{ulidMillisecond}-{n}` from `XADD`. */
export class RedisEventSubscription<T extends { id: string }> implements EventSubscription<T> {
  constructor(
    private readonly redis: RedisClient,
    private readonly streamId: string,
  ) {}

  async restoreLog(options: RestoreLogOptions<T>): Promise<void> {
    await applyEventLogRestore({
      readPages: options.readPages,
      readTailEntryId: () => this.readTailEntryId(),
      appendAfterTail: batch => this.appendAfterTail({ ...batch, streamTTLSeconds: options.streamTTLSeconds }),
      refreshTtl: () => this.refreshTtl(options.streamTTLSeconds),
    });
  }

  async put(event: T, options?: EventSubscriptionPutOptions): Promise<void> {
    const reply: unknown = await this.redis.eval(PUT_STREAM_ENTRY, {
      keys: [this.streamId],
      arguments: [
        this.entryMillisecondFor(event),
        event.id,
        JSON.stringify(event),
        ttlArgument(options?.streamTTLSeconds),
      ],
    });
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
   * A seek for the XREAD cursor, then the same forever-poll as sequence
   * resume. Seek steps and batch reads are separate Redis round-trips on purpose.
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
    let { cursor } = await this.seekEventIdCursor({ mode, eventId, signal });
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
   * Jump near the ULID millisecond (or stream start), then walk forward one
   * bounded Lua step at a time until the seek settles. Returns an exclusive
   * XREAD cursor. See SEEK_EVENT_ID_STEP. An aborted signal ends the walk early.
   */
  private async seekEventIdCursor(input: {
    mode: 'from' | 'after';
    eventId: string;
    signal?: AbortSignal | undefined;
  }): Promise<{ cursor: string; found: boolean }> {
    let cursor = eventIdSeekCursor({
      eventId: input.eventId,
      firstEntryId: await this.firstEntryId(),
    });
    let lastMatch = '';
    let first = true;
    while (input.signal?.aborted !== true) {
      const reply: unknown = await this.redis.eval(SEEK_EVENT_ID_STEP, {
        keys: [this.streamId],
        arguments: [
          input.mode,
          input.eventId,
          cursor,
          String(SUBSCRIBE_STREAM_POLL_ITEMS_COUNT),
          lastMatch,
          first ? '1' : '0',
        ],
      });
      const step = parseSeekReply(reply);
      if (step.state !== 'more') {
        return { cursor: step.cursor, found: step.state === 'found' };
      }
      cursor = step.cursor;
      lastMatch = step.lastMatch;
      first = false;
    }
    return { cursor, found: false };
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

  private async readTailEntryId(): Promise<string | undefined> {
    const entries = await this.redis.xRevRange(this.streamId, '+', '-', { COUNT: 1 });
    return entries[0]?.id;
  }

  private async refreshTtl(streamTTLSeconds: number | undefined): Promise<void> {
    if (streamTTLSeconds !== undefined && streamTTLSeconds > 0) {
      await this.redis.expire(this.streamId, streamTTLSeconds);
    }
  }

  private async appendAfterTail(input: {
    tailEntryId: string | undefined;
    events: T[];
    streamTTLSeconds: number | undefined;
  }): Promise<AppendAfterTailResult> {
    const triples = input.events.flatMap(event => [this.entryMillisecondFor(event), event.id, JSON.stringify(event)]);
    const reply: unknown = await this.redis.eval(APPEND_AFTER_TAIL, {
      keys: [this.streamId],
      arguments: [input.tailEntryId ?? '', ttlArgument(input.streamTTLSeconds), ...triples],
    });
    return parseAppendReply(reply, this.streamId);
  }

  private entryMillisecondFor(event: T): string {
    return String(eventIdTimestampMs(event.id) ?? Date.now());
  }
}
