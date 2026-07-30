export interface EventSubscriptionPutOptions {
  /** Sets the lifetime of the whole stream after this append. */
  streamTTLSeconds?: number | undefined;
}

export type SequencedEvent<T extends object> = T & { sequence_number: number };

export interface EventSubscription<T extends object> {
  /** Appends an event, assigns its sequence number, and returns that number. */
  put(streamId: string, event: T, options?: EventSubscriptionPutOptions): Promise<number>;

  /** Yields events strictly after the supplied sequence, or from the start when omitted. */
  poll(streamId: string, afterSequenceNumber?: number): AsyncGenerator<SequencedEvent<T>, void, unknown>;
}

/** Redis/in-memory key for one turn's resumable event stream. */
export function turnStreamId(tenantId: string, sessionId: string, turnId: string): string {
  return `agent:turn:${tenantId}:${sessionId}:${turnId}:stream`;
}

/** The stream expired or was never created (map to HTTP 412). */
export class StreamGoneError extends Error {
  readonly code = 'STREAM_GONE' as const;

  constructor(readonly streamId: string) {
    super(`Cannot read from stream, stream does not exist anymore: ${streamId}`);
    this.name = 'StreamGoneError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The stream expires too soon to accept a new subscription (map to HTTP 412). */
export class StreamExpiringError extends Error {
  readonly code = 'STREAM_EXPIRING' as const;

  constructor(
    readonly streamId: string,
    readonly expiresAtMs: number,
  ) {
    super(`Cannot subscribe to stream, stream is about to expire: ${streamId}`);
    this.name = 'StreamExpiringError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A stored entry violates the event-subscription wire format (map to HTTP 412). */
export class StreamCorruptEntryError extends Error {
  readonly code = 'STREAM_CORRUPT_ENTRY' as const;

  constructor(
    readonly streamId: string,
    readonly entryId: string,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(`Corrupt stream entry ${entryId} on ${streamId}: ${detail}`, options);
    this.name = 'StreamCorruptEntryError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
