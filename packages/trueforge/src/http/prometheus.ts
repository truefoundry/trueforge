import { prometheus } from '@hono/prometheus';
import type { MiddlewareHandler } from 'hono';
import { Registry } from 'prom-client';

/** Buckets cover multi-minute turn handlers. Longer requests land in +Inf. */
export const HTTP_REQUEST_DURATION_BUCKETS_SECONDS = [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];

/**
 * `help` is shared by both standard metrics. The package's option union drops
 * histogram-only fields, so `buckets` has to ride along with a shared field.
 */
const requestDuration: { help: string; buckets: number[] } = {
  help: 'Duration of HTTP requests in seconds',
  buckets: HTTP_REQUEST_DURATION_BUCKETS_SECONDS,
};

export interface HttpMetrics {
  middleware: MiddlewareHandler;
  handler: MiddlewareHandler;
  registry: Registry;
}

/** Inbound HTTP series plus the registry later operation metrics share. */
export function createHttpMetrics(options?: { collectDefaultMetrics?: boolean }): HttpMetrics {
  const registry = new Registry();
  const { printMetrics, registerMetrics } = prometheus({
    registry,
    collectDefaultMetrics: options?.collectDefaultMetrics ?? true,
    metricOptions: {
      requestDuration,
    },
  });
  return { middleware: registerMetrics, handler: printMetrics, registry };
}
