import { OpenAPIHono } from '@hono/zod-openapi';
import { createLogger } from 'winston';

import { createAppErrorHandler } from '../../../src/app';
import { createHttpMetrics } from '../../../src/http/prometheus';

const SESSION_ROUTE = '/api/v1/sessions/:session_id';
const SESSION_SERIES = `method="GET",route="${SESSION_ROUTE}",status_code="200"`;

function instrumentedApp(): OpenAPIHono {
  const metrics = createHttpMetrics();
  const app = new OpenAPIHono();
  app.use('*', metrics.middleware);
  app.onError(createAppErrorHandler({ logger: createLogger({ silent: true }) }));
  app.get('/metrics', metrics.handler);
  return app;
}

async function scrape(app: OpenAPIHono): Promise<string> {
  const response = await app.request('/metrics');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/plain; version=0.0.4');
  return response.text();
}

function mountSessionRoute(app: OpenAPIHono): void {
  const sessions = new OpenAPIHono();
  sessions.get('/:session_id', c => c.json({ ok: true }));
  app.route('/api/v1/sessions', sessions);
}

describe('createHttpMetrics', () => {
  it('records the route template and leaves the raw id out of the scrape', async () => {
    const app = instrumentedApp();
    mountSessionRoute(app);
    app.use('/*', async (c, next) => next());

    expect((await app.request('/api/v1/sessions/sess_123')).status).toBe(200);
    const body = await scrape(app);

    expect(body).toContain(`http_requests_total{${SESSION_SERIES}} 1`);
    expect(body).toContain(`http_request_duration_seconds_count{${SESSION_SERIES}} 1`);
    expect(body).not.toContain('sess_123');
  });

  it('increments the counter on a second request', async () => {
    const app = instrumentedApp();
    mountSessionRoute(app);

    await app.request('/api/v1/sessions/sess_123');
    await app.request('/api/v1/sessions/sess_456');
    const body = await scrape(app);

    expect(body).toContain(`http_requests_total{${SESSION_SERIES}} 2`);
    expect(body).not.toContain('sess_123');
    expect(body).not.toContain('sess_456');
  });

  it('records /api routes and leaves health, scrape, and asset requests out', async () => {
    const metrics = createHttpMetrics();
    const app = new OpenAPIHono();
    app.use('/api/*', metrics.middleware);
    app.get('/metrics', metrics.handler);
    app.get('/healthz', c => c.json({ ok: true }));
    app.get('/assets/app.js', c => c.text('js'));
    mountSessionRoute(app);

    await app.request('/healthz');
    await app.request('/metrics');
    await app.request('/assets/app.js');
    expect((await app.request('/api/v1/sessions/sess_123')).status).toBe(200);
    expect((await app.request('/api/v1/missing')).status).toBe(404);
    const body = await scrape(app);

    expect(body).toContain(`http_requests_total{${SESSION_SERIES}} 1`);
    expect(body).toContain('http_requests_total{method="GET",route="unmatched",status_code="404"} 1');
    expect(body).not.toContain('route="/api/*"');
    expect(body).not.toContain('route="/healthz"');
    expect(body).not.toContain('route="/metrics"');
    expect(body).not.toContain('route="/assets/app.js"');
    expect(body).not.toContain('sess_123');
  });

  it('counts a thrown handler as 500 after the app error handler', async () => {
    const app = instrumentedApp();
    app.get('/boom', () => {
      throw new Error('boom');
    });

    expect((await app.request('/boom')).status).toBe(500);
    const body = await scrape(app);

    expect(body).toContain('http_requests_total{method="GET",route="/boom",status_code="500"} 1');
  });

  it('labels a path with no route as unmatched', async () => {
    const app = instrumentedApp();

    expect((await app.request('/no/such/route')).status).toBe(404);
    const body = await scrape(app);

    expect(body).toContain('http_requests_total{method="GET",route="unmatched",status_code="404"} 1');
  });

  it('labels a frontend fallback response as /*', async () => {
    const app = instrumentedApp();
    app.use('/*', async c => c.text('shell', 200));

    expect((await app.request('/settings')).status).toBe(200);
    const body = await scrape(app);

    expect(body).toContain('http_requests_total{method="GET",route="/*",status_code="200"} 1');
  });
});
