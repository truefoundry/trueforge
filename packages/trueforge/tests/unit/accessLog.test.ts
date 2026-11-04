import { OpenAPIHono } from '@hono/zod-openapi';
import { Writable } from 'node:stream';
import winston from 'winston';
import { createAccessLogMiddleware } from '../../src/app';
import { STANDALONE_REQUEST_CONTEXT, type RequestContext } from '../../src/auth/identity';

type LogEntry = Record<string, unknown>;

function isLogEntry(value: unknown): value is LogEntry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createCapturingLogger(): { logger: winston.Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const parsed: unknown = JSON.parse(chunk.toString());
      if (isLogEntry(parsed)) {
        entries.push(parsed);
      }
      callback();
    },
  });
  const logger = winston.createLogger({
    format: winston.format.json(),
    transports: [new winston.transports.Stream({ stream })],
  });
  return { logger, entries };
}

const REQUEST_CONTEXT: RequestContext = {
  ...STANDALONE_REQUEST_CONTEXT,
  subject: { id: 'user-123', type: 'user', display_name: 'Jane Doe' },
};

function createApp() {
  const { logger, entries } = createCapturingLogger();
  const app = new OpenAPIHono();
  app.use('*', createAccessLogMiddleware(logger));
  app.get('/authed', c => {
    c.set('request_context', REQUEST_CONTEXT);
    return c.json({ ok: true });
  });
  app.get('/anonymous', c => c.json({ ok: true }));
  app.get('/healthz', c => c.json({ ok: true }));
  return { app, entries };
}

describe('createAccessLogMiddleware', () => {
  it('logs subject_type and subject_id when the request is authenticated', async () => {
    const { app, entries } = createApp();

    await app.request('/authed');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      message: 'request',
      method: 'GET',
      path: '/authed',
      status: 200,
      subject_type: 'user',
      subject_id: 'user-123',
    });
    expect(entries[0]).not.toHaveProperty('subject_display_name');
  });

  it('omits subject fields when no request context was resolved', async () => {
    const { app, entries } = createApp();

    await app.request('/anonymous');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ message: 'request', path: '/anonymous', status: 200 });
    expect(entries[0]).not.toHaveProperty('subject_type');
    expect(entries[0]).not.toHaveProperty('subject_id');
  });

  it('skips /healthz', async () => {
    const { app, entries } = createApp();

    await app.request('/healthz');

    expect(entries).toHaveLength(0);
  });
});
