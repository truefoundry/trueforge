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
  entries: readonly EventLogEntry<T>[];
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
 * computed from. A concurrent writer (live producer or another repair) moves the
 * tail; the suffix is then recomputed, so stale rows never land after newer ones.
 */
export async function applyEventLogRepair<T extends { id: string }>(input: {
  entries: readonly EventLogEntry<T>[];
  claimOwner?: (() => Promise<void>) | undefined;
  readTail: () => Promise<StreamTail | undefined>;
  appendAfterTail: (batch: { tailEntryId: string | undefined; events: T[] }) => Promise<'ok' | 'stale'>;
  refreshTtl: () => Promise<void>;
  /** Producer resume refreshes TTL even when the existing stream is already complete. */
  refreshTtlOnUntouchedStream: boolean;
}): Promise<void> {
  if (input.claimOwner !== undefined) {
    await input.claimOwner();
  }
  for (let attempt = 0; attempt < REPAIR_MAX_ATTEMPTS; attempt += 1) {
    const tail = await input.readTail();
    const suffix = suffixAfterTail(input.entries, tail);
    if (suffix.length === 0) {
      if (input.refreshTtlOnUntouchedStream) {
        await input.refreshTtl();
      }
      return;
    }
    const outcome = await input.appendAfterTail({
      tailEntryId: tail?.entryId,
      events: suffix.map(entry => entry.event),
    });
    if (outcome === 'ok') {
      return;
    }
  }
  throw new Error(`Stream repair gave up after ${String(REPAIR_MAX_ATTEMPTS)} concurrent tail changes`);
}
