import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import winston from 'winston';
import { createZodValidationHook } from '../../src/zodErrorResponse';

const echoRoute = createRoute({
  method: 'post',
  path: '/echo',
  request: {
    body: { content: { 'application/json': { schema: z.object({ name: z.string() }) } } },
  },
  responses: { 200: { description: 'ok' } },
});

describe('createZodValidationHook', () => {
  it('warns with the request and the failing field, and still returns the prettified 400', async () => {
    const logger = winston.createLogger({ silent: true });
    const warnLog = jest.spyOn(logger, 'warn');
    const app = new OpenAPIHono({ defaultHook: createZodValidationHook(logger) });
    app.openapi(echoRoute, c => c.json({ name: c.req.valid('json').name }, 200));

    const response = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 1 }),
    });

    expect(response.status).toBe(400);
    expect(warnLog).toHaveBeenCalledWith(
      'Request validation failed',
      expect.objectContaining({ method: 'POST', path: '/echo', status: 400 }),
    );
  });

  it('stays quiet when the request validates', async () => {
    const logger = winston.createLogger({ silent: true });
    const warnLog = jest.spyOn(logger, 'warn');
    const app = new OpenAPIHono({ defaultHook: createZodValidationHook(logger) });
    app.openapi(echoRoute, c => c.json({ name: c.req.valid('json').name }, 200));

    const response = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ok' }),
    });

    expect(response.status).toBe(200);
    expect(warnLog).not.toHaveBeenCalled();
  });
});
