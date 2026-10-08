import { OpenAPIHono } from '@hono/zod-openapi';
import { ClassifiedHarnessError, classifyError } from '@truefoundry/trueforge-core/core';
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
    // Unrecognised failures stay generic to the caller but are counted by code in the log.
    expect(await response.json()).toEqual({ error: { message: 'Internal server error', code: 'internal_error' } });
    expect(errorLog).toHaveBeenCalledWith('Unhandled error', {
      error: thrown.message,
      stack: thrown.stack,
      error_code: 'internal_error',
      error_source: 'internal',
      retryable: false,
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

  it('reports the code a route attached at the failure source', async () => {
    const logger = winston.createLogger({ silent: true });
    const errorLog = jest.spyOn(logger, 'error');
    const app = new OpenAPIHono();
    const classification = classifyError({
      error: new Error('The operation was aborted due to timeout'),
      source: 'control_plane',
    });
    app.onError(createAppErrorHandler({ logger }));
    app.get('/test', () => {
      throw new HTTPException(500, {
        message: classification.title,
        cause: new ClassifiedHarnessError(classification),
      });
    });

    const response = await app.request('/test');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        message: 'TrueFoundry did not respond in time.',
        code: 'control_plane_timeout',
        type: 'control_plane',
      },
    });
    expect(errorLog).toHaveBeenCalledWith(
      'Server API error',
      expect.objectContaining({ error_code: 'control_plane_timeout', retryable: true }),
    );
  });

  it('omits a code when the route did not classify the failure', async () => {
    const logger = winston.createLogger({ silent: true });
    const app = new OpenAPIHono();
    app.onError(createAppErrorHandler({ logger }));
    app.get('/test', () => {
      throw new HTTPException(409, { message: 'Name taken' });
    });

    const response = await app.request('/test');

    expect(await response.json()).toEqual({ error: { message: 'Name taken' } });
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
