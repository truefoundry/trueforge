import { Writable } from 'node:stream';
import winston from 'winston';
import { createServerLogger, currentLogContext, runWithLogContext } from '../../src/logger';

describe('log context AsyncLocalStorage', () => {
  it('is empty when an AbortSignal listener runs after the request store exits', async () => {
    let signal: AbortSignal | undefined;
    const snapshot = await runWithLogContext(
      { request_id: 'req-1', session_id: 'sess-1', turn_id: 'turn-1', tenant_id: 'ten-1' },
      () => {
        const controller = new AbortController();
        signal = controller.signal;
        return { controller, fields: { ...currentLogContext() } };
      },
    );

    expect(currentLogContext()).toBeUndefined();
    expect(snapshot.fields).toEqual({
      request_id: 'req-1',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      tenant_id: 'ten-1',
    });

    await new Promise<void>(resolve => {
      signal?.addEventListener(
        'abort',
        () => {
          // Hono stream.onAbort is driven by the request AbortSignal the same way.
          expect(currentLogContext()).toBeUndefined();
          resolve();
        },
        { once: true },
      );
      snapshot.controller.abort();
    });
  });
});

describe('printed logs', () => {
  function captureLines(standalone: boolean): { logger: winston.Logger; lines: string[] } {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = createServerLogger({ level: 'info', standalone });
    logger.clear();
    logger.add(new winston.transports.Stream({ stream }));
    return { logger, lines };
  }

  it('omits reportable_error when Sentry has not started', () => {
    for (const standalone of [false, true]) {
      const { logger, lines } = captureLines(standalone);
      logger.error('Unhandled error', {
        error: 'boom',
        reportable_error: { error: new Error('boom'), extra: undefined, filepath: 'trueforge/src/app.ts' },
      });
      expect(lines.join('')).not.toContain('reportable_error');
      expect(lines.join('')).toContain('boom');
    }
  });
});
