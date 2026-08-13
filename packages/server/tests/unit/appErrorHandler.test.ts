import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import winston from 'winston';
import { createAppErrorHandler } from '../../src/app';

describe('createAppErrorHandler', () => {
  it('logs the stack for an unhandled error and returns a generic 500', async () => {
    const logger = winston.createLogger({ silent: true });
    const errorLog = jest.spyOn(logger, 'error');
    const app = new OpenAPIHono();
    const thrown = new Error('unexpected failure');
    app.onError(createAppErrorHandler({ logger }));
    app.get('/test', () => {
      throw thrown;
    });

    const response = await app.request('/test');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { message: 'Internal server error' } });
    expect(errorLog).toHaveBeenCalledWith('Unhandled error', {
      error: thrown.message,
      stack: thrown.stack,
    });
  });

  it('logs the stack and status for a server HTTP exception', async () => {
    const logger = winston.createLogger({ silent: true });
    const errorLog = jest.spyOn(logger, 'error');
    const app = new OpenAPIHono();
    const thrown = new HTTPException(503, { message: 'Service unavailable' });
    app.onError(createAppErrorHandler({ logger }));
    app.get('/test', () => {
      throw thrown;
    });

    const response = await app.request('/test');

    expect(response.status).toBe(503);
    expect(errorLog).toHaveBeenCalledWith('Server API error', {
      status: 503,
      error: thrown.message,
      stack: thrown.stack,
    });
  });

  it('does not error-log a client HTTP exception', async () => {
    const logger = winston.createLogger({ silent: true });
    const errorLog = jest.spyOn(logger, 'error');
    const app = new OpenAPIHono();
    app.onError(createAppErrorHandler({ logger }));
    app.get('/test', () => {
      throw new HTTPException(404, { message: 'Not found' });
    });

    const response = await app.request('/test');

    expect(response.status).toBe(404);
    expect(errorLog).not.toHaveBeenCalled();
  });
});
