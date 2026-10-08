import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import winston from 'winston';
import { createAppErrorHandler } from '../../src/app';
import { zodValidationHook } from '../../src/zodErrorResponse';

function appThrowing(logger: winston.Logger, thrown: unknown): OpenAPIHono {
  const app = new OpenAPIHono();
  app.onError(createAppErrorHandler({ logger }));
  app.get('/test', () => {
    throw thrown;
  });
  return app;
}

const CLIENT_ERROR_CASES: { status: 400 | 422 | 424 }[] = [{ status: 400 }, { status: 422 }, { status: 424 }];

describe('createAppErrorHandler', () => {
  it('logs the stack for an unhandled error and returns a generic 500', async () => {
    const logger = winston.createLogger({ silent: true });
    const errorLog = jest.spyOn(logger, 'error');
    const thrown = new Error('unexpected failure');

    const response = await appThrowing(logger, thrown).request('/test');

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { message: 'Internal server error' } });
    expect(errorLog).toHaveBeenCalledWith('Unhandled error', {
      method: 'GET',
      path: '/test',
      status: 500,
      error: thrown.message,
      stack: thrown.stack,
    });
  });

  it('logs the stack and status for a server HTTP exception', async () => {
    const logger = winston.createLogger({ silent: true });
    const errorLog = jest.spyOn(logger, 'error');
    const thrown = new HTTPException(503, { message: 'Service unavailable' });

    const response = await appThrowing(logger, thrown).request('/test');

    expect(response.status).toBe(503);
    expect(errorLog).toHaveBeenCalledWith('Server API error', {
      method: 'GET',
      path: '/test',
      status: 503,
      error: thrown.message,
      stack: thrown.stack,
    });
  });

  it.each(CLIENT_ERROR_CASES)('warns with the stack for a $status client HTTP exception', async ({ status }) => {
    const logger = winston.createLogger({ silent: true });
    const warnLog = jest.spyOn(logger, 'warn');
    const errorLog = jest.spyOn(logger, 'error');
    const thrown = new HTTPException(status, { message: 'Unknown model "a/b" — provider not configured' });

    const response = await appThrowing(logger, thrown).request('/test');

    expect(response.status).toBe(status);
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).toHaveBeenCalledWith('Client API error', {
      method: 'GET',
      path: '/test',
      status,
      error: thrown.message,
      stack: thrown.stack,
    });
  });

  it('keeps routine auth and not-found rejections at debug', async () => {
    const logger = winston.createLogger({ silent: true });
    const warnLog = jest.spyOn(logger, 'warn');
    const errorLog = jest.spyOn(logger, 'error');
    const debugLog = jest.spyOn(logger, 'debug');
    const thrown = new HTTPException(404, { message: 'Not found' });

    const response = await appThrowing(logger, thrown).request('/test');

    expect(response.status).toBe(404);
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
    expect(debugLog).toHaveBeenCalledWith('Client API error', {
      method: 'GET',
      path: '/test',
      status: 404,
      error: thrown.message,
      stack: thrown.stack,
    });
  });

  it('warns for a thrown ZodError and still returns the prettified 400', async () => {
    const logger = winston.createLogger({ silent: true });
    const warnLog = jest.spyOn(logger, 'warn');
    const parsed = z.object({ name: z.string() }).safeParse({ name: 1 });
    if (parsed.success) {
      throw new Error('expected the fixture to fail validation');
    }

    const response = await appThrowing(logger, parsed.error).request('/test');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: z.prettifyError(parsed.error) } });
    expect(warnLog).toHaveBeenCalledWith(
      'Client API error',
      expect.objectContaining({ method: 'GET', path: '/test', status: 400 }),
    );
  });

  it('keeps the origin stack when a route rethrows with a cause', async () => {
    const logger = winston.createLogger({ silent: true });
    const warnLog = jest.spyOn(logger, 'warn');
    const origin = new Error('Invalid page token: garbage');
    const thrown = new HTTPException(400, { message: origin.message, cause: origin });

    const response = await appThrowing(logger, thrown).request('/test');

    expect(response.status).toBe(400);
    expect(warnLog).toHaveBeenCalledWith('Client API error', {
      method: 'GET',
      path: '/test',
      status: 400,
      error: origin.message,
      stack: thrown.stack,
      cause_stack: origin.stack,
    });
  });

  it('logs and answers request-validation failures thrown by the validation hook', async () => {
    const logger = winston.createLogger({ silent: true });
    const warnLog = jest.spyOn(logger, 'warn');
    const route = createRoute({
      method: 'post',
      path: '/echo',
      request: { body: { content: { 'application/json': { schema: z.object({ name: z.string() }) } } } },
      responses: { 200: { description: 'ok' } },
    });
    const app = new OpenAPIHono({ defaultHook: zodValidationHook });
    app.onError(createAppErrorHandler({ logger }));
    app.openapi(route, c => c.json({ name: c.req.valid('json').name }, 200));

    const response = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 1 }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { message: expect.stringContaining('expected string') },
    });
    expect(warnLog).toHaveBeenCalledWith(
      'Client API error',
      expect.objectContaining({ method: 'POST', path: '/echo', status: 400 }),
    );
  });
});
