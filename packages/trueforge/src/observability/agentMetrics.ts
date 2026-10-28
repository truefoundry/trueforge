import type { OperationMetrics } from '@truefoundry/trueforge-core/core';
import { Counter, Gauge, Histogram, type Registry } from 'prom-client';
import { HTTP_REQUEST_DURATION_BUCKETS_SECONDS } from '../http/prometheus';

/** Turn handlers can run until the 600s subscribe timeout. Other series keep the shared buckets. */
const TURN_DURATION_BUCKETS_SECONDS = [...HTTP_REQUEST_DURATION_BUCKETS_SECONDS, 600];

/** Registers operation series on the registry `GET /metrics` already serves. */
export function createOperationMetrics(registry: Registry): OperationMetrics {
  const requests = new Counter({
    name: 'tfg_outbound_http_requests_total',
    help: 'Outbound HTTP requests',
    labelNames: ['module', 'outcome', 'status_class'],
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'tfg_outbound_http_request_duration_seconds',
    help: 'Outbound HTTP request duration in seconds',
    labelNames: ['module', 'outcome'],
    buckets: HTTP_REQUEST_DURATION_BUCKETS_SECONDS,
    registers: [registry],
  });
  const retries = new Counter({
    name: 'tfg_outbound_http_retries_total',
    help: 'Outbound HTTP retries',
    labelNames: ['module', 'reason'],
    registers: [registry],
  });
  const llmRequests = new Counter({
    name: 'tfg_agent_llm_requests_total',
    help: 'Model calls from an agent step',
    labelNames: ['provider_type', 'outcome'],
    registers: [registry],
  });
  const llmDuration = new Histogram({
    name: 'tfg_agent_llm_request_duration_seconds',
    help: 'Model call duration in seconds, including the provider stream',
    labelNames: ['provider_type', 'outcome', 'finish_reason'],
    buckets: HTTP_REQUEST_DURATION_BUCKETS_SECONDS,
    registers: [registry],
  });
  const llmTimeToFirstToken = new Histogram({
    name: 'tfg_agent_llm_time_to_first_token_seconds',
    help: 'Seconds until the first model token',
    labelNames: ['provider_type'],
    buckets: HTTP_REQUEST_DURATION_BUCKETS_SECONDS,
    registers: [registry],
  });
  const llmStreamErrors = new Counter({
    name: 'tfg_agent_llm_stream_errors_total',
    help: 'Model stream create and read failures',
    labelNames: ['provider_type', 'error_kind', 'status_class'],
    registers: [registry],
  });
  const mcpConnects = new Counter({
    name: 'tfg_agent_mcp_connect_attempts_total',
    help: 'MCP transport connect attempts',
    labelNames: ['transport', 'outcome'],
    registers: [registry],
  });
  const mcpConnectDuration = new Histogram({
    name: 'tfg_agent_mcp_connect_duration_seconds',
    help: 'MCP transport connect duration in seconds',
    labelNames: ['transport', 'outcome'],
    buckets: HTTP_REQUEST_DURATION_BUCKETS_SECONDS,
    registers: [registry],
  });
  const mcpOperations = new Counter({
    name: 'tfg_agent_mcp_operations_total',
    help: 'MCP initialize, list, and call operations',
    labelNames: ['method', 'server_class', 'outcome'],
    registers: [registry],
  });
  const mcpOperationDuration = new Histogram({
    name: 'tfg_agent_mcp_operation_duration_seconds',
    help: 'MCP operation duration in seconds',
    labelNames: ['method', 'server_class', 'outcome'],
    buckets: HTTP_REQUEST_DURATION_BUCKETS_SECONDS,
    registers: [registry],
  });
  const mcpSessionRetries = new Counter({
    name: 'tfg_agent_mcp_session_retries_total',
    help: 'MCP session reconnects after expiry',
    labelNames: ['reason'],
    registers: [registry],
  });
  const mcpDisconnects = new Counter({
    name: 'tfg_agent_mcp_disconnects_total',
    help: 'MCP transport disconnect signals',
    labelNames: ['via'],
    registers: [registry],
  });
  const harnessLimits = new Counter({
    name: 'tfg_agent_harness_limits_total',
    help: 'Times a configured harness cap fired',
    labelNames: ['limit'],
    registers: [registry],
  });
  const toolCallDuration = new Histogram({
    name: 'tfg_agent_tool_call_duration_seconds',
    help: 'Tool call duration in seconds',
    labelNames: ['server_class', 'outcome'],
    buckets: HTTP_REQUEST_DURATION_BUCKETS_SECONDS,
    registers: [registry],
  });
  const activeThreads = new Counter({
    name: 'tfg_agent_active_threads_total',
    help: 'Agent threads started in this process',
    registers: [registry],
  });
  const turnDuration = new Histogram({
    name: 'tfg_agent_turn_duration_seconds',
    help: 'Turn duration in seconds',
    labelNames: ['terminal_status'],
    buckets: TURN_DURATION_BUCKETS_SECONDS,
    registers: [registry],
  });
  const activeTurns = new Gauge({
    name: 'tfg_agent_active_turns',
    help: 'Turns running in this process',
    registers: [registry],
  });
  const turnTimeouts = new Counter({
    name: 'tfg_agent_turn_timeouts_total',
    help: 'Turn execution, subscribe, and SSE write timeouts',
    labelNames: ['phase'],
    registers: [registry],
  });
  const turnSseDisconnects = new Counter({
    name: 'tfg_agent_turn_sse_disconnects_total',
    help: 'SSE client disconnects during a turn',
    labelNames: ['path'],
    registers: [registry],
  });
  const turnPersistErrors = new Counter({
    name: 'tfg_agent_turn_persist_errors_total',
    help: 'Turn store write failures',
    labelNames: ['phase'],
    registers: [registry],
  });
  const parallelRequests = new Counter({
    name: 'tfg_parallel_web_requests_total',
    help: 'Parallel search and extract requests',
    labelNames: ['operation', 'outcome'],
    registers: [registry],
  });
  const parallelDuration = new Histogram({
    name: 'tfg_parallel_web_request_duration_seconds',
    help: 'Parallel search and extract duration in seconds',
    labelNames: ['operation', 'outcome'],
    buckets: HTTP_REQUEST_DURATION_BUCKETS_SECONDS,
    registers: [registry],
  });
  const parallelPartialErrors = new Counter({
    name: 'tfg_parallel_web_partial_errors_total',
    help: 'Page errors returned by a successful Parallel extract',
    registers: [registry],
  });
  const serviceFoundryRequests = new Counter({
    name: 'tfg_servicefoundry_requests_total',
    help: 'ServiceFoundry control-plane requests',
    labelNames: ['operation', 'outcome', 'status_class'],
    registers: [registry],
  });
  const serviceFoundryDuration = new Histogram({
    name: 'tfg_servicefoundry_request_duration_seconds',
    help: 'ServiceFoundry request duration in seconds',
    labelNames: ['operation', 'outcome'],
    buckets: HTTP_REQUEST_DURATION_BUCKETS_SECONDS,
    registers: [registry],
  });
  const postgresQueryDuration = new Histogram({
    name: 'tfg_postgres_query_duration_seconds',
    help: 'Postgres query duration in seconds',
    labelNames: ['outcome'],
    buckets: HTTP_REQUEST_DURATION_BUCKETS_SECONDS,
    registers: [registry],
  });

  return {
    recordOutboundHttpRequest({ module, outcome, statusClass, durationSeconds }): void {
      requests.inc({ module, outcome, status_class: statusClass });
      duration.observe({ module, outcome }, durationSeconds);
    },
    recordOutboundHttpRetry({ module, reason }): void {
      retries.inc({ module, reason });
    },
    recordLlmRequest({ providerType, outcome, finishReason, durationSeconds }): void {
      llmRequests.inc({ provider_type: providerType, outcome });
      llmDuration.observe({ provider_type: providerType, outcome, finish_reason: finishReason }, durationSeconds);
    },
    recordLlmTimeToFirstToken({ providerType, durationSeconds }): void {
      llmTimeToFirstToken.observe({ provider_type: providerType }, durationSeconds);
    },
    recordLlmStreamError({ providerType, errorKind, statusClass }): void {
      llmStreamErrors.inc({ provider_type: providerType, error_kind: errorKind, status_class: statusClass });
    },
    recordMcpConnect({ transport, outcome, durationSeconds }): void {
      mcpConnects.inc({ transport, outcome });
      mcpConnectDuration.observe({ transport, outcome }, durationSeconds);
    },
    recordMcpOperation({ method, serverClass, outcome, durationSeconds }): void {
      mcpOperations.inc({ method, server_class: serverClass, outcome });
      mcpOperationDuration.observe({ method, server_class: serverClass, outcome }, durationSeconds);
    },
    recordMcpSessionRetry({ reason }): void {
      mcpSessionRetries.inc({ reason });
    },
    recordMcpDisconnect({ via }): void {
      mcpDisconnects.inc({ via });
    },
    recordHarnessLimit({ limit }): void {
      harnessLimits.inc({ limit });
    },
    recordToolCall({ serverClass, outcome, durationSeconds }): void {
      toolCallDuration.observe({ server_class: serverClass, outcome }, durationSeconds);
    },
    recordActiveThreads({ count }): void {
      activeThreads.inc(count);
    },
    recordTurnDuration({ terminalStatus, durationSeconds }): void {
      turnDuration.observe({ terminal_status: terminalStatus }, durationSeconds);
    },
    recordActiveTurns({ delta }): void {
      if (delta === 1) {
        activeTurns.inc();
        return;
      }
      activeTurns.dec();
    },
    recordTurnTimeout({ phase }): void {
      turnTimeouts.inc({ phase });
    },
    recordTurnSseDisconnect({ path }): void {
      turnSseDisconnects.inc({ path });
    },
    recordTurnPersistError({ phase }): void {
      turnPersistErrors.inc({ phase });
    },
    recordParallelWebRequest({ operation, outcome, durationSeconds }): void {
      parallelRequests.inc({ operation, outcome });
      parallelDuration.observe({ operation, outcome }, durationSeconds);
    },
    recordParallelWebPartialErrors({ count }): void {
      parallelPartialErrors.inc(count);
    },
    recordServiceFoundryRequest({ operation, outcome, statusClass, durationSeconds }): void {
      serviceFoundryRequests.inc({ operation, outcome, status_class: statusClass });
      serviceFoundryDuration.observe({ operation, outcome }, durationSeconds);
    },
    recordPostgresQuery({ outcome, durationSeconds }): void {
      postgresQueryDuration.observe({ outcome }, durationSeconds);
    },
  };
}
