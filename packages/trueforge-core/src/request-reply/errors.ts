/** The target executor's heartbeat is missing or nobody is subscribed (map to HTTP 412). */
export class NoResponderError extends Error {
  readonly code = 'NO_RESPONDER' as const;
  constructor(
    readonly executorId: string,
    readonly detail = 'heartbeat not present',
  ) {
    super(`No responder for executor: ${executorId} (${detail}).`);
    this.name = 'NoResponderError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** No reply arrived within the wait budget (map to HTTP 424). */
export class RequestTimeoutError extends Error {
  readonly code = 'REQUEST_TIMEOUT' as const;
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Request timed out after ${String(timeoutMs)}ms`);
    this.name = 'RequestTimeoutError';
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown by route handlers (or the router itself) to reply with a specific
 * status; the executor converts it to a JSONReply instead of a blanket 500.
 */
export class ReplyError extends Error {
  readonly code = 'REPLY_ERROR' as const;
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ReplyError';
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
