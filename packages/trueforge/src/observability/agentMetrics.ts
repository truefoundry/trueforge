import type { OperationMetrics } from '@truefoundry/trueforge-core/core';
import { Counter, Histogram, type Registry } from 'prom-client';
import { HTTP_REQUEST_DURATION_BUCKETS_SECONDS } from '../http/prometheus';

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
  };
}
