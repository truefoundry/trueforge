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

/** Extra Prometheus text appended to `GET /metrics`. Read on each scrape. */
let metricsScrapeAppendix: (() => Promise<string>) | undefined;
let metricsScrapeOnError: ((error: unknown) => void) | undefined;

/** OpenTelemetry SDK meters (Daytona, Redis) are not prom-client metrics, so their Prometheus text is appended here. */
export function setMetricsScrapeAppendix(options: {
  scrape: () => Promise<string>;
  onError: (error: unknown) => void;
}): void {
  metricsScrapeAppendix = options.scrape;
  metricsScrapeOnError = options.onError;
}

/** A failed SDK appendix must not hide the prom-client series. */
async function readMetricsScrapeAppendix(): Promise<string> {
  if (metricsScrapeAppendix === undefined) {
    return '';
  }
  try {
    return await metricsScrapeAppendix();
  } catch (error) {
    metricsScrapeOnError?.(error);
    return '';
  }
}

/** Inbound HTTP series plus the registry later operation metrics share. */
export function createHttpMetrics(): HttpMetrics {
  const registry = new Registry();
  const { registerMetrics } = prometheus({
    registry,
    collectDefaultMetrics: true,
    metricOptions: {
      requestDuration,
    },
  });
  const handler: MiddlewareHandler = async c => {
    const body = await registry.metrics();
    const extra = await readMetricsScrapeAppendix();
    return c.text(extra.length === 0 ? body : `${body}${extra}`);
  };
  return { middleware: registerMetrics, handler, registry };
}
