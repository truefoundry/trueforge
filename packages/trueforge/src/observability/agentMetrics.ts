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

  return {
    recordOutboundHttpRequest({ module, outcome, statusClass, durationSeconds }): void {
      requests.inc({ module, outcome, status_class: statusClass });
      duration.observe({ module, outcome }, durationSeconds);
    },
    recordOutboundHttpRetry({ module, reason }): void {
      retries.inc({ module, reason });
    },
  };
}
