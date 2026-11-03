/**
 * Rebuild a turn's live event stream from the durable log.
 * Append uses the same event-id stream ids as a live put. The durable row
 * order is the order. No sequence number is assigned.
 */

export interface EventLogEntry<T extends { id: string }> {
  /** Payload id. The Redis stream id is not this value. */
  id: string;
  event: T;
}

export interface RepairLogOptions<T extends { id: string }> {
  /**
   * Durable rows in persist order, one page at a time. Called again when a
   * concurrent append moves the tail, so the walk restarts from the first page.
   */
  readPages: () => AsyncIterable<readonly EventLogEntry<T>[]>;
  streamTTLSeconds?: number | undefined;
  /**
   * Set by the database owner that is about to produce. Claims the stream-owner
   * key. A subscribe repair omits this and does not claim.
   */
  executorId?: string | undefined;
}

export interface StreamTail {
  entryId: string;
  eventId: string;
  /** JSON written on the stream, used to tell shared-id rows apart. */
  payload: string;
}

/** `'stale'` means the tail moved and the caller must recompute. */
export type AppendAfterTailResult = { status: 'ok'; tailEntryId: string } | { status: 'stale' };

/** One page, for a caller that already holds the rows. Each call starts a new walk. */
export function eventLogPages<T extends { id: string }>(
  entries: readonly EventLogEntry<T>[],
): () => AsyncIterable<readonly EventLogEntry<T>[]> {
  return () =>
    (async function* () {
      await Promise.resolve();
      yield entries;
    })();
}

/** Backfill gives up after this many concurrent tail moves. */
const REPAIR_MAX_ATTEMPTS = 5;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Key order and a legacy `sequence_number` field are not part of event identity. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => canonicalize(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (key === 'sequence_number') {
      continue;
    }
    const child = value[key];
    if (child !== undefined) {
      normalized[key] = canonicalize(child);
    }
  }
  return normalized;
}

export function eventPayloadMatches(event: object, payload: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return false;
  }
  return JSON.stringify(canonicalize(event)) === JSON.stringify(canonicalize(parsed));
}

/** Payload id from a stream data field. Undefined when JSON is corrupt or id is missing. */
export function eventIdFromStreamData(data: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || !('id' in parsed)) {
    return undefined;
  }
  return typeof parsed.id === 'string' ? parsed.id : undefined;
}

/**
 * Rows after the stream tail. Rows that share an id (a message and its deltas)
 * are distinguished by the stored payload. A tail the log does not contain is
 * left alone.
 */
function suffixAfterTail<T extends { id: string }>(
  entries: readonly EventLogEntry<T>[],
  tail: StreamTail | undefined,
): EventLogEntry<T>[] {
  if (tail === undefined) {
    return [...entries];
  }
  // Prefer an exact payload match. The live tip may be a model.message.delta
  // that was never durable; fall back to the last durable row with the same id
  // (the message shell) so later durable events still append.
  let match = -1;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry?.id === tail.eventId && eventPayloadMatches(entry.event, tail.payload)) {
      match = index;
    }
  }
  if (match === -1) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (entries[index]?.id === tail.eventId) {
        match = index;
        break;
      }
    }
  }
  if (match === -1) {
    return [];
  }
  return entries.slice(match + 1);
}

/**
 * Appends the missing suffix only while the stream tail is still the one it was
 * computed from. Pages stay in persist order: an empty stream is filled from
 * the start, and an existing stream appends only after its tail. A concurrent
 * writer moves the tail; the walk restarts, so stale rows never land after newer ones.
 */
export async function applyEventLogRepair<T extends { id: string }>(input: {
  readPages: () => AsyncIterable<readonly EventLogEntry<T>[]>;
  claimOwner?: (() => Promise<void>) | undefined;
  readTail: () => Promise<StreamTail | undefined>;
  appendAfterTail: (batch: { tailEntryId: string | undefined; events: T[] }) => Promise<AppendAfterTailResult>;
  refreshTtl: () => Promise<void>;
  /** Producer resume refreshes TTL even when the existing stream is already complete. */
  refreshTtlOnUntouchedStream: boolean;
}): Promise<void> {
  if (input.claimOwner !== undefined) {
    await input.claimOwner();
  }
  for (let attempt = 0; attempt < REPAIR_MAX_ATTEMPTS; attempt += 1) {
    const tail = await input.readTail();
    const outcome = await appendMissingPages({
      readPages: input.readPages,
      tail,
      appendAfterTail: input.appendAfterTail,
    });
    if (outcome === 'stale') {
      continue;
    }
    if (outcome === 'untouched' && input.refreshTtlOnUntouchedStream) {
      await input.refreshTtl();
    }
    return;
  }
  throw new Error(`Stream repair gave up after ${String(REPAIR_MAX_ATTEMPTS)} concurrent tail changes`);
}

/**
 * One page is in memory at a time. The next page's expected tail is the entry
 * id the previous append wrote, so a producer cannot land between the two.
 */
async function appendMissingPages<T extends { id: string }>(input: {
  readPages: () => AsyncIterable<readonly EventLogEntry<T>[]>;
  tail: StreamTail | undefined;
  appendAfterTail: (batch: { tailEntryId: string | undefined; events: T[] }) => Promise<AppendAfterTailResult>;
}): Promise<'appended' | 'untouched' | 'stale'> {
  let expectedTailId = input.tail?.entryId;
  let passedTail = input.tail === undefined;
  let appended = false;
  for await (const page of input.readPages()) {
    let rows: readonly EventLogEntry<T>[];
    if (!passedTail) {
      const tail = input.tail;
      if (tail === undefined || !page.some(entry => entry.id === tail.eventId)) {
        continue;
      }
      passedTail = true;
      rows = suffixAfterTail(page, tail);
    } else {
      rows = page;
    }
    if (rows.length === 0) {
      continue;
    }
    const outcome = await input.appendAfterTail({
      tailEntryId: expectedTailId,
      events: rows.map(entry => entry.event),
    });
    if (outcome.status === 'stale') {
      return 'stale';
    }
    expectedTailId = outcome.tailEntryId;
    appended = true;
  }
  if (!passedTail) {
    return 'untouched';
  }
  return appended ? 'appended' : 'untouched';
}
