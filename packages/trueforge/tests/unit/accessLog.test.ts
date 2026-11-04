import { OpenAPIHono } from '@hono/zod-openapi';
import winston from 'winston';
import { createAccessLogMiddleware, createAppErrorHandler } from '../../src/app';
import type { Authenticator } from '../../src/auth/authenticator';
import { STANDALONE_REQUEST_CONTEXT, type RequestContext } from '../../src/auth/identity';
import { buildAdminAuthMiddleware, createAuthMiddleware } from '../../src/auth/middleware';

const NON_ADMIN_CONTEXT: RequestContext = {
  tenant_id: 'default',
  subject: { id: 'bob', type: 'user', display_name: 'Bob' },
  roles: [],
  user_credential: null,
};

function authenticatorFor(requestContext: RequestContext | undefined): Authenticator {
  return {
    authenticate: () => {
      if (requestContext === undefined) {
        return Promise.reject(new Error('unexpected authenticate call'));
      }
      return Promise.resolve(requestContext);
    },
  };
}

function createApp({ logger, requestContext }: { logger: winston.Logger; requestContext?: RequestContext }) {
  const authenticator = authenticatorFor(requestContext);
  const app = new OpenAPIHono();
  app.use('*', createAccessLogMiddleware(logger));
  app.onError(createAppErrorHandler({ logger }));
  app.get('/public', c => c.json({ ok: true }));

  const models = new OpenAPIHono();
  models.use('*', createAuthMiddleware(authenticator));
  models.get('/', c => c.json({ ok: true }));
  app.route('/api/v1/models', models);

  const settings = new OpenAPIHono();
  settings.use('*', buildAdminAuthMiddleware({ authenticator, accessible: true }));
  settings.get('/', c => c.json({ ok: true }));
  app.route('/api/v1/settings', settings);

  return app;
}

describe('createAccessLogMiddleware', () => {
  it('logs the subject type and id of an authenticated caller', async () => {
    const logger = winston.createLogger({ silent: true });
    const infoLog = jest.spyOn(logger, 'info');

    const response = await createApp({ logger, requestContext: STANDALONE_REQUEST_CONTEXT }).request('/api/v1/models');

    expect(response.status).toBe(200);
    expect(infoLog).toHaveBeenCalledWith('request', {
      method: 'GET',
      path: '/api/v1/models',
      status: 200,
      duration_ms: expect.any(Number),
      subject_type: STANDALONE_REQUEST_CONTEXT.subject.type,
      subject_id: STANDALONE_REQUEST_CONTEXT.subject.id,
    });
  });

  it('logs the subject of a caller rejected by the admin gate', async () => {
    const logger = winston.createLogger({ silent: true });
    const infoLog = jest.spyOn(logger, 'info');

    const response = await createApp({ logger, requestContext: NON_ADMIN_CONTEXT }).request('/api/v1/settings');

    expect(response.status).toBe(403);
    expect(infoLog).toHaveBeenCalledWith(
      'request',
      expect.objectContaining({ status: 403, subject_type: 'user', subject_id: 'bob' }),
    );
  });

  it('omits subject fields when the request is not authenticated', async () => {
    const logger = winston.createLogger({ silent: true });
    const infoLog = jest.spyOn(logger, 'info');

    const response = await createApp({ logger }).request('/public');

    expect(response.status).toBe(200);
    expect(infoLog).toHaveBeenCalledWith('request', {
      method: 'GET',
      path: '/public',
      status: 200,
      duration_ms: expect.any(Number),
    });
  });
});
