/**
 * Rebuild a turn's live event stream from the durable log.
 * Append uses the same event-id stream ids as a live put. The durable row
 * order is the order. No sequence number is assigned.
 */

export interface EventLogEntry<T extends object> {
  /** Payload id. The Redis stream id is not this value. */
  id: string;
  event: T;
}

export interface RepairLogOptions<T extends object> {
  entries: readonly EventLogEntry<T>[];
  streamTTLSeconds?: number | undefined;
  /**
   * Set by the database owner that is about to produce. Claims the stream-owner
   * key. A subscribe repair omits this and does not claim.
   */
  executorId?: string | undefined;
}

interface StreamTail {
  eventId: string;
  /** JSON written on the stream, used to tell shared-id rows apart. */
  payload: string;
}

export function eventIdOf(event: object): string | undefined {
  if (!('id' in event)) {
    return undefined;
  }
  const id = event.id;
  return typeof id === 'string' ? id : undefined;
}

export function eventIdFromStreamData(data: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  return eventIdOf(parsed);
}

/**
 * Rows after the stream tail. Rows that share an id (a message and its deltas)
 * are distinguished by the stored payload. A tail the log does not contain is
 * left alone.
 */
function suffixAfterTail<T extends object>(
  entries: readonly EventLogEntry<T>[],
  tail: StreamTail | undefined,
): EventLogEntry<T>[] {
  if (tail === undefined) {
    return [...entries];
  }
  let match = -1;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry?.id === tail.eventId && JSON.stringify(entry.event) === tail.payload) {
      match = index;
    }
  }
  if (match === -1) {
    return [];
  }
  return entries.slice(match + 1);
}

export async function applyEventLogRepair<T extends object>(input: {
  entries: readonly EventLogEntry<T>[];
  claimOwner?: (() => Promise<void>) | undefined;
  readTail: () => Promise<StreamTail | undefined>;
  append: (entry: EventLogEntry<T>) => Promise<'appended' | 'duplicate'>;
  refreshTtl: () => Promise<void>;
  /** Producer resume refreshes TTL even when the existing stream is already complete. */
  refreshTtlOnUntouchedStream: boolean;
}): Promise<void> {
  if (input.claimOwner !== undefined) {
    await input.claimOwner();
  }
  const tail = await input.readTail();
  const suffix = suffixAfterTail(input.entries, tail);
  let appended = false;
  for (const entry of suffix) {
    const outcome = await input.append(entry);
    if (outcome === 'appended') {
      appended = true;
    }
  }
  if (appended || input.refreshTtlOnUntouchedStream) {
    await input.refreshTtl();
  }
}
