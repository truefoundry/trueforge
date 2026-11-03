import { decodeTime } from 'ulid';

/**
 * Old streams used `{sequence}-1` with a small sequence. A unix-millisecond id
 * is far above this. The cutoff is a temporary compat check, not an event limit.
 */
export const LEGACY_SEQUENCE_ID_MAX = 50_000;

/** Redis stream sequence is an unsigned 64-bit integer. The id just before `{ms}-0` is `{ms-1}` plus this. */
const REDIS_MAX_SEQUENCE = '18446744073709551615';

/** Millisecond from a ULID event id. Other ids have no timestamp. */
export function eventIdTimestampMs(eventId: string): number | undefined {
  try {
    return decodeTime(eventId);
  } catch {
    return undefined;
  }
}

export function entryIdMilliseconds(entryId: string): number {
  const separator = entryId.indexOf('-');
  const raw = separator === -1 ? entryId : entryId.slice(0, separator);
  const milliseconds = Number(raw);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error(`Corrupt stream entry id ${entryId}`);
  }
  return milliseconds;
}

export function isLegacySequenceEntryId(entryId: string): boolean {
  return entryIdMilliseconds(entryId) <= LEGACY_SEQUENCE_ID_MAX;
}

/**
 * Where an event-id scan starts. A leftover `{sequence}-1` stream is ordered by
 * sequence, not by the payload ULID, so the scan has to walk it from the start.
 */
export function eventIdSeekCursor(input: { eventId: string; firstEntryId: string | undefined }): string {
  if (input.firstEntryId !== undefined && isLegacySequenceEntryId(input.firstEntryId)) {
    return '0-0';
  }
  const timestamp = eventIdTimestampMs(input.eventId);
  if (timestamp === undefined) {
    return '0-0';
  }
  return exclusiveCursorBeforeMillisecond(timestamp);
}

/** Exclusive XREAD cursor that includes every entry at `milliseconds` and later. */
export function exclusiveCursorBeforeMillisecond(milliseconds: number): string {
  if (milliseconds <= 0) {
    return '0-0';
  }
  return `${String(milliseconds - 1)}-${REDIS_MAX_SEQUENCE}`;
}

function entryIdSequence(entryId: string): bigint {
  const separator = entryId.indexOf('-');
  const raw = separator === -1 ? '0' : entryId.slice(separator + 1);
  return BigInt(raw);
}

/** Redis stream order: millisecond, then the per-millisecond counter. */
export function compareEntryIds(left: string, right: string): number {
  const leftMs = entryIdMilliseconds(left);
  const rightMs = entryIdMilliseconds(right);
  if (leftMs !== rightMs) {
    return leftMs < rightMs ? -1 : 1;
  }
  const leftSequence = entryIdSequence(left);
  const rightSequence = entryIdSequence(right);
  if (leftSequence === rightSequence) {
    return 0;
  }
  return leftSequence < rightSequence ? -1 : 1;
}

export function isEntryAfterCursor(entryId: string, cursor: string): boolean {
  return compareEntryIds(entryId, cursor) > 0;
}

/**
 * `from` yields at the first payload id match. `after` yields after the last
 * match already buffered, then skips a later copy of that id. An id missing
 * from the buffer is dropped and later entries are yielded.
 */
export class EventIdSeek<T extends { id: string }> {
  private phase: 'scan' | 'yield' = 'scan';
  private readonly buffered: T[] = [];

  constructor(
    private readonly mode: 'from' | 'after',
    private readonly eventId: string,
  ) {}

  push(event: T): T[] {
    if (this.phase === 'yield') {
      if (this.mode === 'after' && event.id === this.eventId) {
        return [];
      }
      return [event];
    }
    this.buffered.push(event);
    if (this.mode === 'from' && event.id === this.eventId) {
      this.phase = 'yield';
      const start = this.buffered.findIndex(item => item.id === this.eventId);
      const emit = this.buffered.slice(start);
      this.buffered.length = 0;
      return emit;
    }
    return [];
  }

  caughtUp(): T[] {
    if (this.phase === 'yield') {
      return [];
    }
    this.phase = 'yield';
    if (this.mode === 'from') {
      this.buffered.length = 0;
      return [];
    }
    let lastMatch = -1;
    for (let index = 0; index < this.buffered.length; index += 1) {
      if (this.buffered[index]?.id === this.eventId) {
        lastMatch = index;
      }
    }
    const emit = lastMatch === -1 ? [] : this.buffered.slice(lastMatch + 1);
    this.buffered.length = 0;
    return emit;
  }
}
