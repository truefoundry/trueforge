import type { OperationMetrics } from '@truefoundry/trueforge-core/core';
import { Counter, Histogram, type Registry } from 'prom-client';
import { HTTP_REQUEST_DURATION_BUCKETS_SECONDS } from '../http/prometheus';

/** Registers operation series on the registry `GET /metrics` already serves. */
export function createOperationMetrics(registry: Registry): OperationMetrics {
  const requests = new Counter({
    name: 'outbound_http_requests_total',
    help: 'Outbound HTTP requests',
    labelNames: ['pool', 'outcome', 'status_code'],
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'outbound_http_request_duration_seconds',
    help: 'Outbound HTTP request duration in seconds',
    labelNames: ['pool', 'outcome'],
    buckets: HTTP_REQUEST_DURATION_BUCKETS_SECONDS,
    registers: [registry],
  });

  return {
    recordOutboundHttpRequest({ pool, outcome, statusCode, durationSeconds }): void {
      requests.inc({ pool, outcome, status_code: statusCode === 'none' ? 'none' : String(statusCode) });
      duration.observe({ pool, outcome }, durationSeconds);
    },
  };
}
