/** Which outbound undici pool served the call. The Prometheus label is `module`. */
export type OutboundHttpModule = 'generic' | 'model' | 'mcp';

/** Transport result. Status class is a separate label. */
export type OutboundHttpOutcome = 'success' | 'error' | 'timeout' | 'blocked';

/** Response class. `none` means the call failed before a response. */
export type OutboundHttpStatusClass = '2xx' | '3xx' | '4xx' | '5xx' | 'none';

/**
 * Why a retry was taken. Transport timeouts use names. HTTP retries use the status that was replayed.
 * Body timeouts are not retried.
 */
export type OutboundHttpRetryReason =
  | 'connect_timeout'
  | 'headers_timeout'
  | '408'
  | '409'
  | '429'
  | '502'
  | '503'
  | '520'
  | '521'
  | '522'
  | '523'
  | '524'
  | '530';

/**
 * Server-owned operation metrics. Core times work and reports outcomes; it does not
 * import a metrics client. Callers that are not recording omit the recorder.
 */
export interface OperationMetrics {
  recordOutboundHttpRequest(options: {
    module: OutboundHttpModule;
    outcome: OutboundHttpOutcome;
    statusClass: OutboundHttpStatusClass;
    durationSeconds: number;
  }): void;
  recordOutboundHttpRetry(options: { module: OutboundHttpModule; reason: OutboundHttpRetryReason }): void;
}

/** Seconds since a `performance.now()` reading. */
export function elapsedSeconds(startedMs: number): number {
  return (performance.now() - startedMs) / 1000;
}
