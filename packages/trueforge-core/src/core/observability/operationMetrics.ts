import type { FinishReason } from '../llm/LLMTypes';
import type { VercelAIProviderName } from '../llm/VercelAILLM';

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
/** HTTP statuses that the retry policy may replay. */
export type OutboundHttpRetryStatus = 408 | 409 | 429 | 502 | 503 | 520 | 521 | 522 | 523 | 524 | 530;

export type OutboundHttpRetryReason = 'connect_timeout' | 'headers_timeout' | OutboundHttpRetryStatus;

/** Configured model provider. The model name stays off the label. */
export type LlmProviderType = VercelAIProviderName;

/** How the model call ended. Finish reason is a separate duration label. */
export type LlmRequestOutcome = 'success' | 'error' | 'aborted';

/** Existing finish-reason enum, plus `none` when the stream never produced one. */
export type LlmFinishReason = FinishReason | 'none';

/** Where a model stream failed. `abort` covers a cancelled call before a finish reason. */
export type LlmStreamErrorKind = 'api_call' | 'stream_part' | 'abort' | 'unknown';

/** Remote MCP transport probe. */
export type McpTransport = 'streamable-http' | 'sse';

/** Result of one transport probe. `success` is the probe that was kept. */
export type McpConnectOutcome = 'success' | 'auth' | 'session_expired' | 'timeout' | 'other';

/** MCP method. Server URL, server id, and tool name stay off the label. */
export type McpMethod = 'initialize' | 'tools/list' | 'tools/call';

export type McpServerClass = 'remote' | 'local' | 'sandbox';

export type McpOperationOutcome = 'success' | 'auth_required' | 'error';

export type McpDisconnectVia = 'onclose' | 'onerror';

/** A configured cap the harness applied. */
export type HarnessLimit =
  | 'mcp_response_bytes'
  | 'iteration_limit'
  | 'large_tool_response_individual'
  | 'large_tool_response_total'
  | 'context_compaction'
  | 'context_compaction_error';

/** Tool-call result. `paused` is approval or a client-side tool, not a failure. */
export type ToolCallOutcome = 'success' | 'tool_error' | 'thrown' | 'auth_required' | 'unknown_tool' | 'paused';

/** MCP server class, plus `unknown` when the model names a tool that is not registered. */
export type ToolCallServerClass = McpServerClass | 'unknown';

/** Terminal turn status. `paused` is not terminal. */
export type TurnTerminalStatus = 'done' | 'error' | 'cancelled';

/** Where a turn timer fired. */
export type TurnTimeoutPhase = 'execution' | 'sse_write' | 'subscribe';

/** Which SSE handler lost the client. */
export type TurnSsePath = 'create' | 'subscribe';

/** Which turn store write failed. */
export type TurnPersistPhase = 'append' | 'terminal';

/** Parallel Search or Extract. Query text and URLs stay off the label. */
export type ParallelWebOperation = 'search' | 'extract';

export type ParallelWebOutcome = 'success' | 'error';

/** Fixed ServiceFoundry caller. The request URL is not a label. */
export type ServiceFoundryOperation =
  | 'get_session'
  | 'vend_token'
  | 'model_providers'
  | 'gateway_installations'
  | 'mcp_servers'
  | 'agents'
  | 'skills'
  | 'agent_permissions'
  | 'tenant_permissions'
  | 'users';

export type ServiceFoundryOutcome = 'success' | 'error' | 'timeout';

/** Postgres query result. SQL text and table names stay off the label. */
export type PostgresQueryOutcome = 'success' | 'error';

/**
 * Server-owned operation metrics. Core times work and reports outcomes; it does not
 * import a metrics client. The process installs one recorder with `configureOperationMetrics`.
 * An unset recorder skips timing.
 */
export interface OperationMetrics {
  recordOutboundHttpRequest(options: {
    module: OutboundHttpModule;
    outcome: OutboundHttpOutcome;
    statusClass: OutboundHttpStatusClass;
    durationSeconds: number;
  }): void;
  recordOutboundHttpRetry(options: { module: OutboundHttpModule; reason: OutboundHttpRetryReason }): void;
  recordLlmRequest(options: {
    providerType: LlmProviderType;
    outcome: LlmRequestOutcome;
    finishReason: LlmFinishReason;
    durationSeconds: number;
  }): void;
  recordLlmTimeToFirstToken(options: { providerType: LlmProviderType; durationSeconds: number }): void;
  recordLlmStreamError(options: {
    providerType: LlmProviderType;
    errorKind: LlmStreamErrorKind;
    statusClass: OutboundHttpStatusClass;
  }): void;
  recordMcpConnect(options: { transport: McpTransport; outcome: McpConnectOutcome; durationSeconds: number }): void;
  recordMcpOperation(options: {
    method: McpMethod;
    serverClass: McpServerClass;
    outcome: McpOperationOutcome;
    durationSeconds: number;
  }): void;
  recordMcpSessionRetry(options: { reason: 'session_expired' }): void;
  recordMcpDisconnect(options: { via: McpDisconnectVia }): void;
  recordHarnessLimit(options: { limit: HarnessLimit }): void;
  recordToolCall(options: {
    serverClass: ToolCallServerClass;
    outcome: ToolCallOutcome;
    durationSeconds: number;
  }): void;
  /** Threads started in one parallel batch. The root counts when it is the leaf. */
  recordActiveThreads(options: { count: number }): void;
  recordTurnDuration(options: { terminalStatus: TurnTerminalStatus; durationSeconds: number }): void;
  /** `1` when a turn starts in this process, `-1` when that run leaves the registry. */
  recordActiveTurns(options: { delta: 1 | -1 }): void;
  recordTurnTimeout(options: { phase: TurnTimeoutPhase }): void;
  recordTurnSseDisconnect(options: { path: TurnSsePath }): void;
  recordTurnPersistError(options: { phase: TurnPersistPhase }): void;
  recordParallelWebRequest(options: {
    operation: ParallelWebOperation;
    outcome: ParallelWebOutcome;
    durationSeconds: number;
  }): void;
  recordParallelWebPartialErrors(options: { count: number }): void;
  recordServiceFoundryRequest(options: {
    operation: ServiceFoundryOperation;
    outcome: ServiceFoundryOutcome;
    statusClass: OutboundHttpStatusClass;
    durationSeconds: number;
  }): void;
  recordPostgresQuery(options: { outcome: PostgresQueryOutcome; durationSeconds: number }): void;
}

let currentOperationMetrics: OperationMetrics | undefined;

/** Install the process recorder. `undefined` clears it. One recorder per process. */
export function configureOperationMetrics(metrics: OperationMetrics | undefined): void {
  currentOperationMetrics = metrics;
}

/** The process recorder, or `undefined` when this process is not recording. */
export function getOperationMetrics(): OperationMetrics | undefined {
  return currentOperationMetrics;
}

/** Time `run` and record one MCP operation. An unset recorder skips the timer. */
export async function observeMcpOperation<T>({
  method,
  serverClass,
  run,
  outcomeOf,
  outcomeOfError,
}: {
  method: McpMethod;
  serverClass: McpServerClass;
  run: () => Promise<T>;
  outcomeOf: (result: T) => McpOperationOutcome;
  outcomeOfError?: (error: unknown) => McpOperationOutcome;
}): Promise<T> {
  const metrics = getOperationMetrics();
  if (metrics === undefined) {
    return run();
  }
  const startedMs = performance.now();
  try {
    const result = await run();
    metrics.recordMcpOperation({
      method,
      serverClass,
      outcome: outcomeOf(result),
      durationSeconds: elapsedSeconds(startedMs),
    });
    return result;
  } catch (error) {
    metrics.recordMcpOperation({
      method,
      serverClass,
      outcome: outcomeOfError === undefined ? 'error' : outcomeOfError(error),
      durationSeconds: elapsedSeconds(startedMs),
    });
    throw error;
  }
}

/** Seconds since a `performance.now()` reading. */
export function elapsedSeconds(startedMs: number): number {
  return (performance.now() - startedMs) / 1000;
}

/** `none` covers a missing code and any status outside 200-599. */
export function httpStatusClass(status: number | undefined): OutboundHttpStatusClass {
  if (status === undefined) {
    return 'none';
  }
  if (status >= 200 && status < 300) {
    return '2xx';
  }
  if (status >= 300 && status < 400) {
    return '3xx';
  }
  if (status >= 400 && status < 500) {
    return '4xx';
  }
  if (status >= 500 && status < 600) {
    return '5xx';
  }
  return 'none';
}
