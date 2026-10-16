/** Bounded label for which outbound undici pool served the call. */
export type OutboundHttpPool = 'generic' | 'model' | 'mcp';

/** Transport result. The exact HTTP status is a separate label. */
export type OutboundHttpOutcome = 'success' | 'error' | 'timeout' | 'blocked';

/** Exact response status. `none` means the call failed before a response. */
export type OutboundHttpStatusCode = number | 'none';

/**
 * Server-owned operation metrics. Core times work and reports outcomes; it does not
 * import a metrics client. Callers that are not recording use the noop.
 */
export interface OperationMetrics {
  recordOutboundHttpRequest(options: {
    pool: OutboundHttpPool;
    outcome: OutboundHttpOutcome;
    statusCode: OutboundHttpStatusCode;
    durationSeconds: number;
  }): void;
}

export const NOOP_OPERATION_METRICS: OperationMetrics = {
  recordOutboundHttpRequest(): void {
    /* no-op */
  },
};

/** Seconds since a `performance.now()` reading. */
export function elapsedSeconds(startedMs: number): number {
  return (performance.now() - startedMs) / 1000;
}
