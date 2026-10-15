import { Counter, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';
import type { Context, MiddlewareHandler } from 'hono';
import { matchedRoutes } from 'hono/route';

const HTTP_METRIC_LABELS = ['method', 'route', 'status_code'] as const;

/** Methods this API serves. Any other verb shares one series so clients cannot grow the registry. */
const RECORDED_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);

function methodLabel(method: string): string {
  return RECORDED_METHODS.has(method) ? method : 'other';
}

/** Buckets cover multi-minute turn handlers. Longer requests land in +Inf. */
const DURATION_BUCKETS_SECONDS = [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];

/** `app.use('/api/*')` and the frontend `/*` handlers are mounts, not route templates. */
function isWildcardRoute(path: string): boolean {
  return path === '*' || path.endsWith('/*');
}

/**
 * The last concrete route wins, so a later `/*` handler does not replace the API template.
 * A 404 with no concrete route was not served by a handler.
 */
function routeLabel(routes: readonly { path: string }[], status: number): string {
  let concrete: string | undefined;
  for (const route of routes) {
    if (!isWildcardRoute(route.path)) {
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
      const labels = {
        method: methodLabel(c.req.method),
        // We need matchedRoutes to get the route template, and not the actual route path.
        // For example, for path template "/api/v1/sessions/:ID", the actual route path is "/api/v1/sessions/123",
        // And 123 can be any string.
        // So we match the route template to get the route label.
        route: routeLabel(matchedRoutes(c), c.res.status),
        status_code: String(c.res.status),
      };
      requests.inc(labels);
      duration.observe(labels, (performance.now() - started) / 1000);
    }
  };

  const handler = async (c: Context): Promise<Response> =>
    c.body(await registry.metrics(), 200, {
      'Content-Type': registry.contentType,
    });

  return { registry, middleware, handler };
}
