import { Writable } from 'node:stream';
import winston from 'winston';
import { captureCriticalException } from '../../../src/sentry/captureCriticalException';
import { reportMarkedLogFormat } from '../../../src/sentry/reportMarkedLog';

jest.mock('../../../src/sentry/captureCriticalException', () => ({
  captureCriticalException: jest.fn(),
}));

function loggedLines(): { logger: winston.Logger; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = winston.createLogger({
    format: winston.format.combine(reportMarkedLogFormat(), winston.format.json()),
    transports: [new winston.transports.Stream({ stream })],
  });
  return { logger, lines };
}

describe('reportMarkedLogFormat', () => {
  beforeEach(() => {
    jest.mocked(captureCriticalException).mockClear();
  });

  it('reports a marked record and removes the marker from the printed line', () => {
    const failure = new Error('boom');
    const { logger, lines } = loggedLines();
    logger.error('Unhandled error', {
      error: 'boom',
      reportable_error: { error: failure, extra: { path: '/api' } },
    });

    expect(captureCriticalException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { path: '/api' },
    });
    const reported: unknown = jest.mocked(captureCriticalException).mock.calls[0]?.[0];
    expect(reported).toBeInstanceOf(Error);
    if (!(reported instanceof Error)) {
      return;
    }
    expect(reported.message).toBe('Unhandled error');
    expect(reported.cause).toBe(failure);
    const reportedFrames = reported.stack?.slice(reported.stack.indexOf('\n') + 1);
    const causeFrames = failure.stack?.slice((failure.stack?.indexOf('\n') ?? -1) + 1);
    expect(reportedFrames).toBe(causeFrames);
    expect(failure.message).toBe('boom');
    expect(lines.join('')).not.toContain('reportable_error');
  });

  it('leaves unmarked lines in Winston only', () => {
    const { logger } = loggedLines();
    logger.error('Client API error', { error: 'bad request' });
    logger.error('Error reading LLM stream', { error: 'invalid api key' });

    expect(captureCriticalException).not.toHaveBeenCalled();
  });

  it('reports each repeated marked log', () => {
    const { logger } = loggedLines();
    const failure = new Error('socket closed');
    logger.error('[Redis] Client error', { reportable_error: { error: failure } });
    logger.error('[Redis] Client error', { reportable_error: { error: failure } });
    expect(captureCriticalException).toHaveBeenCalledTimes(2);
  });
});
