import type { RedisClient } from '@truefoundry/trueforge-core/request-reply';
import { randomUUID } from 'node:crypto';
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
import { applyEventLogRestore, type RestoreLogOptions, type RestoreLogOutcome } from './restore';
import { pagesExtendingLease, shareRestore, withRedisRestoreTurn, type RestoreLeaseClient } from './restoreFlight';

const SUBSCRIBE_STREAM_POLL_ITEMS_COUNT = 100;
/** Delay between XREAD polls while a stream has no new events (a blocking XREAD would monopolize the shared connection). */
const SUBSCRIBE_STREAM_POLL_SLEEP_INTERVAL_MS = 1_000;

/** Lua helper shared by the seek scripts. Old entries have no id field; decoding is limited to those. */
const PAYLOAD_ID_LUA = `
local function payloadId(fields)
  local data = nil
  for j = 1, #fields, 2 do
    if fields[j] == 'id' then return fields[j + 1] end
    if fields[j] == 'data' then data = fields[j + 1] end
  end
  if data == nil then return nil end
  local ok, obj = pcall(cjson.decode, data)
  if ok and type(obj) == 'table' and type(obj['id']) == 'string' then
    return obj['id']
  end
  return nil
end
`;

/**
 * One bounded forward step to the first entry with a payload id. The TS side
 * loops, so Redis serves other clients between batches.
 *
 * KEYS[1]=stream  ARGV[1]=payload id  ARGV[2]=exclusive start  ARGV[3]=batch
 * ARGV[4]='1' on the first step
 *
 * Returns {state, cursor}. `cursor` is an exclusive XREAD cursor.
 * more → continue from `cursor`. found → the entry before the first match.
 * missing → the last entry seen (live-only resume).
 */
const SEEK_FIRST_STEP = `${PAYLOAD_ID_LUA}
local targetId, cursor, batch = ARGV[1], ARGV[2], tonumber(ARGV[3])
local entries = redis.call('XRANGE', KEYS[1], '(' .. cursor, '+', 'COUNT', batch)
if #entries == 0 then
  if ARGV[4] == '1' then
    -- Start was past the tip (e.g. a future ULID ms): park at the real tip so
    -- XREAD still sees later live appends instead of waiting above them.
    local tip = redis.call('XREVRANGE', KEYS[1], '+', '-', 'COUNT', 1)
    if tip[1] ~= nil then
      return {'missing', tip[1][1]}
    end
  end
  return {'missing', cursor}
end
local previous = cursor
for i = 1, #entries do
  if payloadId(entries[i][2]) == targetId then
    return {'found', previous}
  end
  previous = entries[i][1]
end
if #entries < batch then
  return {'missing', previous}
end
return {'more', previous}
`;

/**
 * One bounded backward step to the last entry with a payload id. Walking down
 * from the tip, the first match is the last one, so a recent cursor settles in one step.
 *
 * KEYS[1]=stream  ARGV[1]=payload id  ARGV[2]=exclusive floor  ARGV[3]=batch
 * ARGV[4]=exclusive upper bound ('' = the tip)  ARGV[5]=tip seen so far ('' = none)
 *
 * Returns {state, cursor, tip}. found → the last entry with the id (XREAD cursor).
 * more → continue below `cursor`. missing → `cursor` is the tip (live-only resume).
 */
const SEEK_LAST_STEP = `${PAYLOAD_ID_LUA}
local targetId, floor, batch, upper, tip = ARGV[1], ARGV[2], tonumber(ARGV[3]), ARGV[4], ARGV[5]
local high = '+'
if upper ~= '' then high = '(' .. upper end
local entries = redis.call('XREVRANGE', KEYS[1], high, '(' .. floor, 'COUNT', batch)
if tip == '' then
  if upper == '' and entries[1] ~= nil then
    tip = entries[1][1]
  else
    local last = redis.call('XREVRANGE', KEYS[1], '+', '-', 'COUNT', 1)
    if last[1] ~= nil then tip = last[1][1] end
  end
end
for i = 1, #entries do
  if payloadId(entries[i][2]) == targetId then
    return {'found', entries[i][1], tip}
  end
end
if #entries < batch then
  if tip == '' then
    return {'missing', '0-0', tip}
  end
  return {'missing', tip, tip}
end
return {'more', entries[#entries][1], tip}
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

function ttlArgument(streamTTLSeconds: number | undefined): string {
  return String(streamTTLSeconds !== undefined && streamTTLSeconds > 0 ? streamTTLSeconds : 0);
}

interface SeekStep {
  state: 'more' | 'found' | 'missing';
  cursor: string;
  /** Only set by the backward step. */
  tip: string;
}

function parseSeekReply(value: unknown): SeekStep {
  if (Array.isArray(value) && (value.length === 2 || value.length === 3)) {
    const state: unknown = value[0];
    const cursor: unknown = value[1];
    const tip: unknown = value[2] ?? '';
    if (
      (state === 'more' || state === 'found' || state === 'missing') &&
      typeof cursor === 'string' &&
      typeof tip === 'string'
    ) {
      return { state, cursor, tip };
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

  restoreLog(options: RestoreLogOptions<T>): Promise<RestoreLogOutcome> {
    const redis = this.redis;
    const lease: RestoreLeaseClient = {
      set: (key, value, setOptions) => redis.set(key, value, setOptions),
      eval: (script, evalOptions) => redis.eval(script, evalOptions),
    };
    const restore = (extendLease: () => Promise<void>) =>
      applyEventLogRestore({
        readPages: () => pagesExtendingLease(options.readPages(), extendLease),
        readTailEntryId: () => this.readTailEntryId(),
        installIfAbsent: pages => this.installIfAbsent(pages, options.streamTTLSeconds),
        refreshTtl: () => this.refreshTtl(options.streamTTLSeconds),
      });
    // One replica reads the log. Others wait, then keep the stream that won.
    return shareRestore(`redis:${this.streamId}`, () =>
      withRedisRestoreTurn({
        redis: lease,
        streamId: this.streamId,
        readTailEntryId: () => this.readTailEntryId(),
        refreshTtl: () => this.refreshTtl(options.streamTTLSeconds),
        run: restore,
      }),
    );
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
   * Bound the walk at the ULID millisecond (or stream start), then run bounded
   * Lua steps until the seek settles. `from` walks up to the first match; `after`
   * walks down from the tip to the last one. Returns an exclusive XREAD cursor.
   * An aborted signal ends the walk early.
   */
  private async seekEventIdCursor(input: {
    mode: 'from' | 'after';
    eventId: string;
    signal?: AbortSignal | undefined;
  }): Promise<{ cursor: string; found: boolean }> {
    const floor = eventIdSeekCursor({
      eventId: input.eventId,
      firstEntryId: await this.firstEntryId(),
    });
    const batch = String(SUBSCRIBE_STREAM_POLL_ITEMS_COUNT);
    let cursor = input.mode === 'from' ? floor : '';
    let tip = '';
    let first = true;
    while (input.signal?.aborted !== true) {
      const reply: unknown =
        input.mode === 'from'
          ? await this.redis.eval(SEEK_FIRST_STEP, {
              keys: [this.streamId],
              arguments: [input.eventId, cursor, batch, first ? '1' : '0'],
            })
          : await this.redis.eval(SEEK_LAST_STEP, {
              keys: [this.streamId],
              arguments: [input.eventId, floor, batch, cursor, tip],
            });
      const step = parseSeekReply(reply);
      if (step.state !== 'more') {
        return { cursor: step.cursor, found: step.state === 'found' };
      }
      cursor = step.cursor;
      tip = step.tip;
      first = false;
    }
    return { cursor: cursor === '' ? floor : cursor, found: false };
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

  /**
   * Writes the log to a private key, then swaps it in only if the stream is still
   * absent. A lost swap deletes the copy. The build is pipelined per page; the
   * swap is the atomic step, so a reader never sees a prefix.
   */
  private async installIfAbsent(
    pages: AsyncIterable<readonly T[]>,
    streamTTLSeconds: number | undefined,
  ): Promise<boolean> {
    const tempKey = `${this.streamId}:restore:${randomUUID()}`;
    let previousMs = 0;
    let wrote = false;
    try {
      for await (const page of pages) {
        const writes: Promise<string>[] = [];
        for (const event of page) {
          const ms = Math.max(Number(this.entryMillisecondFor(event)), previousMs);
          previousMs = ms;
          writes.push(this.redis.xAdd(tempKey, `${String(ms)}-*`, { id: event.id, data: JSON.stringify(event) }));
        }
        if (writes.length === 0) {
          continue;
        }
        await Promise.all(writes);
        wrote = true;
        await this.expireKey(tempKey, streamTTLSeconds);
      }
      if (!wrote) {
        return true;
      }
      // Restart the clock so a slow read does not expire the key at the moment of the swap.
      await this.expireKey(tempKey, streamTTLSeconds);
      const renamed = await this.redis.renameNX(tempKey, this.streamId);
      if (renamed === 1) {
        return true;
      }
      await this.redis.del(tempKey);
      return false;
    } catch (error) {
      await this.redis.del(tempKey).catch(() => undefined);
      throw error;
    }
  }

  private async expireKey(key: string, streamTTLSeconds: number | undefined): Promise<void> {
    if (streamTTLSeconds !== undefined && streamTTLSeconds > 0) {
      await this.redis.expire(key, streamTTLSeconds);
    }
  }

  private entryMillisecondFor(event: T): string {
    return String(eventIdTimestampMs(event.id) ?? Date.now());
  }
}
