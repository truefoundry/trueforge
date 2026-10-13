import { OpenAPIHono } from '@hono/zod-openapi';
import { createLogger } from 'winston';

import { createClientCertificateMiddleware } from '../../../src/http/tls';

type CertlessSocket = { incoming: { socket: object } };

function createApp(): OpenAPIHono<{ Bindings: CertlessSocket }> {
  const app = new OpenAPIHono<{ Bindings: CertlessSocket }>();
  app.use('*', createClientCertificateMiddleware(createLogger({ silent: true })));
  app.get('/healthz', c => c.json({ ok: true }));
  app.get('/metrics', c => c.text('metrics'));
  app.get('/api/v1/sessions', c => c.json({ ok: true }));
  return app;
}

const certless: CertlessSocket = { incoming: { socket: {} } };

describe('createClientCertificateMiddleware', () => {
  it('allows /healthz and /metrics without a client certificate', async () => {
    const app = createApp();

    expect((await app.request('/healthz', {}, certless)).status).toBe(200);
    expect((await app.request('/metrics', {}, certless)).status).toBe(200);
  });

  it('rejects other paths without a client certificate', async () => {
    const app = createApp();

    const response = await app.request('/api/v1/sessions', {}, certless);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { message: 'Client certificate required' } });
  });
});
