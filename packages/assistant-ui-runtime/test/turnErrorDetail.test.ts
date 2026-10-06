import { describe, expect, it } from 'vitest';

import { readTurnErrorDetail, toTurnErrorDetail } from '../src/turnErrorDetail.js';

describe('toTurnErrorDetail', () => {
  it('carries every classification field a server sent', () => {
    expect(
      toTurnErrorDetail({
        status: 'error',
        message: 'The model provider did not respond in time.',
        code: 'model_timeout',
        source: 'model',
        retryable: true,
        detail: 'terminated: Body Timeout Error',
        completedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toEqual({
      message: 'The model provider did not respond in time.',
      code: 'model_timeout',
      source: 'model',
      retryable: true,
      detail: 'terminated: Body Timeout Error',
    });
  });

  it('omits fields an unclassified failure does not carry', () => {
    expect(
      toTurnErrorDetail({ status: 'error', message: 'Something went wrong', completedAt: '2026-01-01T00:00:00.000Z' }),
    ).toEqual({ message: 'Something went wrong' });
  });

  it('keeps retryable false rather than dropping it', () => {
    const detail = toTurnErrorDetail({
      status: 'error',
      message: 'The model rejected the request.',
      retryable: false,
      completedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(detail.retryable).toBe(false);
  });
});

describe('readTurnErrorDetail', () => {
  it('round-trips a structured detail', () => {
    const detail = { message: 'Timed out', code: 'model_timeout', retryable: true, detail: 'Body Timeout Error' };
    expect(readTurnErrorDetail(detail)).toEqual(detail);
  });

  it('accepts a bare string from a host that still writes one', () => {
    expect(readTurnErrorDetail('plain failure')).toEqual({ message: 'plain failure' });
  });

  it('returns undefined when there is no error to show', () => {
    expect(readTurnErrorDetail(undefined)).toBeUndefined();
    expect(readTurnErrorDetail(null)).toBeUndefined();
    expect(readTurnErrorDetail('')).toBeUndefined();
    expect(readTurnErrorDetail({ code: 'model_timeout' })).toBeUndefined();
  });

  it('does not stringify an object into [object Object]', () => {
    expect(readTurnErrorDetail({ message: 'real message' })?.message).toBe('real message');
  });
});
