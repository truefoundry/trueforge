import { Counter, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';
import type { Context, MiddlewareHandler } from 'hono';
import { matchedRoutes } from 'hono/route';

const HTTP_METRIC_LABELS = ['method', 'route', 'status_code'] as const;

/** Buckets cover multi-minute turn handlers. Longer requests land in +Inf. */
const DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];

const SKIP_EXACT_PATHS = new Set(['/healthz', '/metrics']);
const ASSETS_PREFIX = '/assets/';

function shouldSkip(path: string): boolean {
  return SKIP_EXACT_PATHS.has(path) || path.startsWith(ASSETS_PREFIX);
}

/**
 * Hono reports `app.use('*')` as `/*`, so the metrics middleware is always a wildcard match.
 * A 404 with no concrete route was not served by the frontend fallback.
 */
function routeLabel(routes: readonly { path: string }[], status: number): string {
  let concrete: string | undefined;
  for (const route of routes) {
    if (route.path !== '*' && route.path !== '/*') {
      concrete = route.path;
    }
  }
  if (concrete !== undefined) {
    return concrete;
  }
  if (status === 404) {
    return 'unmatched';
  }
  return '/*';
}

export function createHttpMetrics(): {
  registry: Registry;
  middleware: MiddlewareHandler;
  handler: (c: Context) => Promise<Response>;
} {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const requests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests handled by the agent server',
    labelNames: HTTP_METRIC_LABELS,
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration until the handler returns',
    labelNames: HTTP_METRIC_LABELS,
    buckets: DURATION_BUCKETS_SECONDS,
    registers: [registry],
  });

  const middleware: MiddlewareHandler = async (c, next) => {
    const started = performance.now();
    try {
      await next();
    } finally {
      if (!shouldSkip(c.req.path)) {
        const labels = {
          method: c.req.method,
          route: routeLabel(matchedRoutes(c), c.res.status),
          status_code: String(c.res.status),
        };
        requests.inc(labels);
        duration.observe(labels, (performance.now() - started) / 1000);
      }
    }
  };

  const handler = async (c: Context): Promise<Response> =>
    c.body(await registry.metrics(), 200, {
      'Content-Type': registry.contentType,
    });

  return { registry, middleware, handler };
}
