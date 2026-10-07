import { Hono } from 'hono';
import winston from 'winston';
import { logRequestError } from '../../../src/http/requestErrorLog';

async function logFrom({ logger, status, error }: { logger: winston.Logger; status: number; error: unknown }) {
  const app = new Hono();
  app.get('/api/v1/sessions/s-1/turns', c => {
    logRequestError({ logger, c, status, error, message: 'Client API error' });
    return c.json({}, 200);
  });
  await app.request('/api/v1/sessions/s-1/turns');
}

describe('logRequestError', () => {
  it('carries the request, the status and the error chain with its stack', async () => {
    const logger = winston.createLogger({ silent: true });
    const warnLog = jest.spyOn(logger, 'warn');
    const error = new Error('provider not configured', { cause: new Error('no integrations on token') });

    await logFrom({ logger, status: 422, error });

    expect(warnLog).toHaveBeenCalledWith('Client API error', {
      method: 'GET',
      path: '/api/v1/sessions/s-1/turns',
      status: 422,
      error: 'provider not configured: no integrations on token',
      stack: error.stack,
    });
  });

  it.each([400, 409, 422, 424, 429])('warns for a %i response', async status => {
    const logger = winston.createLogger({ silent: true });
    const warnLog = jest.spyOn(logger, 'warn');

    await logFrom({ logger, status, error: new Error('boom') });

    expect(warnLog).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404])('keeps a %i response at debug', async status => {
    const logger = winston.createLogger({ silent: true });
    const warnLog = jest.spyOn(logger, 'warn');
    const debugLog = jest.spyOn(logger, 'debug');

    await logFrom({ logger, status, error: new Error('boom') });

    expect(warnLog).not.toHaveBeenCalled();
    expect(debugLog).toHaveBeenCalledTimes(1);
  });

  it.each([500, 502, 503])('escalates a %i response to error', async status => {
    const logger = winston.createLogger({ silent: true });
    const warnLog = jest.spyOn(logger, 'warn');
    const errorLog = jest.spyOn(logger, 'error');

    await logFrom({ logger, status, error: new Error('boom') });

    expect(warnLog).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});
