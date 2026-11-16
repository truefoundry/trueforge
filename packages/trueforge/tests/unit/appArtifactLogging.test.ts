import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import winston from 'winston';
import { createAccessLogMiddleware, createAppErrorHandler, pathForLogs } from '../../src/app';
import { ArtifactRequestError } from '../../src/artifacts/ArtifactService';

describe('artifact error codes and log redaction', () => {
  it('exposes the code of an artifact error and nothing from other causes', async () => {
    const app = new OpenAPIHono();
    app.onError(createAppErrorHandler({ logger: winston.createLogger({ silent: true }) }));
    app.get('/artifact', () => {
      const cause = new ArtifactRequestError(409, 'slug_taken', 'taken');
      throw new HTTPException(409, { message: 'taken', cause });
    });
    app.get('/system', () => {
      const cause = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
      throw new HTTPException(409, { message: 'upstream unavailable', cause });
    });

    const artifact = await app.request('/artifact');
    expect(await artifact.json()).toEqual({ error: { message: 'taken', code: 'slug_taken' } });
    const system = await app.request('/system');
    expect(await system.json()).toEqual({ error: { message: 'upstream unavailable' } });
  });

  it('keeps the content token out of the access log and the error log', async () => {
    const logger = winston.createLogger({ silent: true });
    const info = jest.spyOn(logger, 'info');
    const warn = jest.spyOn(logger, 'warn');
    const app = new OpenAPIHono();
    app.use('*', createAccessLogMiddleware(logger));
    app.onError(createAppErrorHandler({ logger }));
    app.get('/artifact-content/:token/*', () => {
      throw new HTTPException(400, { message: 'bad request' });
    });

    await app.request('/artifact-content/secret-token/assets/app.css');

    const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(logged).not.toContain('secret-token');
    expect(logged).toContain('/artifact-content/:token');
  });

  it('only rewrites content paths', () => {
    expect(pathForLogs('/artifact-content/abc.def/index.html')).toBe('/artifact-content/:token/index.html');
    expect(pathForLogs('/artifact-content/abc.def')).toBe('/artifact-content/:token');
    expect(pathForLogs('/api/v1/artifacts')).toBe('/api/v1/artifacts');
  });
});
