/**
 * Rebuild a turn's live event stream from the durable log.
 * Sequence numbers already stored are written back as explicit stream ids.
 * An event with no number yet takes max(stored) + 1 in persist order.
 */

export interface EventLogEntry<T extends object> {
  /** Payload id. Compared with the stream tail. Redis stream ids are sequence numbers, not this. */
  id: string;
  event: T;
  sequence_number?: number | undefined;
}

interface SequencedLogEntry<T extends object> {
  id: string;
  event: T;
  sequence_number: number;
}

export interface RepairLogOptions<T extends object> {
  entries: readonly EventLogEntry<T>[];
  streamTTLSeconds?: number | undefined;
  /**
   * Set by the database owner that is about to produce. Claims the stream-owner
   * key. A subscribe repair omits this and does not claim.
   */
  executorId?: string | undefined;
  /**
   * Persist numbers assigned to events that did not have one. Called even when
   * the list is empty so the owner fence runs before the stream is touched.
   */
  persistSequences?: (assignments: { event_id: string; sequence_number: number }[]) => Promise<void>;
}

interface StreamTail {
  eventId: string;
  sequenceNumber: number;
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

function planSequences<T extends object>(
  entries: readonly EventLogEntry<T>[],
): {
  sequenced: SequencedLogEntry<T>[];
  newlyAssigned: { event_id: string; sequence_number: number }[];
} {
  let maxStored = 0;
  for (const entry of entries) {
    const sequence = entry.sequence_number;
    if (sequence !== undefined && sequence > maxStored) {
      maxStored = sequence;
    }
  }
  const sequenced: SequencedLogEntry<T>[] = [];
  const newlyAssigned: { event_id: string; sequence_number: number }[] = [];
  let next = maxStored;
  for (const entry of entries) {
    if (entry.sequence_number === undefined) {
      next += 1;
      sequenced.push({ id: entry.id, event: entry.event, sequence_number: next });
      newlyAssigned.push({ event_id: entry.id, sequence_number: next });
    } else {
      sequenced.push({ id: entry.id, event: entry.event, sequence_number: entry.sequence_number });
    }
  }
  return { sequenced, newlyAssigned };
}

/**
 * Suffix the stream does not already have. Redis explicit ids must increase, so
 * the suffix is appended in sequence order. That matches persist order when
 * numbers were assigned as events were streamed.
 */
function suffixAfterTail<T extends object>(
  sequenced: readonly SequencedLogEntry<T>[],
  tail: StreamTail | undefined,
): SequencedLogEntry<T>[] {
  if (tail === undefined) {
    return [...sequenced].sort((left, right) => left.sequence_number - right.sequence_number);
  }
  const last = sequenced[sequenced.length - 1];
  if (last?.id === tail.eventId) {
    return [];
  }
  const tailIndex = sequenced.findIndex(entry => entry.id === tail.eventId);
  const after =
    tailIndex >= 0
      ? sequenced.slice(tailIndex + 1)
      : sequenced.filter(entry => entry.sequence_number > tail.sequenceNumber);
  return [...after].sort((left, right) => left.sequence_number - right.sequence_number);
}

function nextSequence(sequenced: readonly { sequence_number: number }[], tail: StreamTail | undefined): number {
  let max = tail?.sequenceNumber ?? 0;
  for (const entry of sequenced) {
    if (entry.sequence_number > max) {
      max = entry.sequence_number;
    }
  }
  return max + 1;
}

export async function applyEventLogRepair<T extends object>(input: {
  entries: readonly EventLogEntry<T>[];
  persistSequences?: RepairLogOptions<T>['persistSequences'];
  claimOwner?: (() => Promise<void>) | undefined;
  readTail: () => Promise<StreamTail | undefined>;
  append: (entry: SequencedLogEntry<T>) => Promise<'appended' | 'duplicate'>;
  refreshTtl: () => Promise<void>;
  /** Producer resume refreshes TTL even when the existing stream is already complete. */
  refreshTtlOnUntouchedStream: boolean;
}): Promise<number> {
  const plan = planSequences(input.entries);
  if (input.persistSequences !== undefined) {
    await input.persistSequences(plan.newlyAssigned);
  }
  if (input.claimOwner !== undefined) {
    await input.claimOwner();
  }
  const tail = await input.readTail();
  const suffix = suffixAfterTail(plan.sequenced, tail);
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
  return nextSequence(plan.sequenced, tail);
}
