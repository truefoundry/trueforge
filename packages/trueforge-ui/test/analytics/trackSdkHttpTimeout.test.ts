import { describe, expect, it, vi } from 'vitest';

import { AnalyticsEvents } from '@/analytics/events.js';
import {
  bindSdkHttpTimeoutTracking,
  isSdkHttpTimeoutError,
  withSdkHttpTimeoutTracking,
} from '@/analytics/trackSdkHttpTimeout.js';

describe('isSdkHttpTimeoutError', () => {
  it('matches TrueForgeTimeoutError by name', () => {
    const error = Object.assign(new Error('Timeout exceeded when calling POST /v1/sessions.'), {
      name: 'TrueForgeTimeoutError',
    });
    expect(isSdkHttpTimeoutError(error)).toBe(true);
  });

  it('matches the SDK timeout message shape', () => {
    expect(isSdkHttpTimeoutError(new Error('Timeout exceeded when calling GET /v1/agents.'))).toBe(true);
  });

  it('matches the opaque bare "timeout" message', () => {
    expect(isSdkHttpTimeoutError(new Error('timeout'))).toBe(true);
    expect(isSdkHttpTimeoutError('timeout')).toBe(true);
  });

  it('matches the JSON-quoted abort reason the SDK puts on TrueForgeError', () => {
    const error = Object.assign(new Error('"timeout"'), { name: 'TrueForgeError' });
    expect(isSdkHttpTimeoutError(error)).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isSdkHttpTimeoutError(new Error('boom'))).toBe(false);
    expect(isSdkHttpTimeoutError({ statusCode: 500 })).toBe(false);
    expect(isSdkHttpTimeoutError(null)).toBe(false);
  });
});

describe('withSdkHttpTimeoutTracking', () => {
  it('reports the request endpoint for a timeout and ignores other failures', async () => {
    const track = vi.fn();
    bindSdkHttpTimeoutTracking(track);

    const timeoutSignal = new AbortController();
    timeoutSignal.abort('timeout');
    let failure: unknown = 'timeout';
    const wrapped = withSdkHttpTimeoutTracking(async () => {
      throw failure;
    });

    await expect(
      wrapped('http://localhost:3000/api/v1/sessions/abc/events?limit=20', {
        method: 'GET',
        signal: timeoutSignal.signal,
      }),
    ).rejects.toBe('timeout');

    failure = new Error('boom');
    await expect(
      wrapped('http://localhost:3000/api/v1/agents', {
        method: 'POST',
      }),
    ).rejects.toThrow('boom');

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(AnalyticsEvents.Sdk.HTTP_TIMEOUT, {
      endpoint: 'GET /api/v1/sessions/abc/events',
    });

    bindSdkHttpTimeoutTracking(null);
  });
});
