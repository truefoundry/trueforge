import { describe, expect, it } from 'vitest';

import { getErrorMessage } from '@/utils/getErrorMessage.js';

describe('getErrorMessage', () => {
  it('prefers error.message', () => {
    expect(getErrorMessage({ message: 'top', error: { message: 'nested' } })).toBe('top');
  });

  it('falls back to error.error.message', () => {
    expect(getErrorMessage({ error: { message: 'nested' } })).toBe('nested');
  });

  it('prefers HTTP body error.message over the Error message', () => {
    const err = Object.assign(new Error('Status code: 409\nBody: …'), {
      statusCode: 409,
      body: { error: { message: 'Name taken' } },
    });
    expect(getErrorMessage(err)).toBe('Name taken');
  });

  it('stringifies a non-message HTTP body', () => {
    const err = Object.assign(new Error('request failed'), {
      statusCode: 422,
      body: { detail: 'invalid agent' },
    });
    expect(getErrorMessage(err)).toBe(JSON.stringify({ detail: 'invalid agent' }));
  });

  it('uses fallback when nothing is extractable', () => {
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
    expect(getErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('stringifies the value when both messages are missing and there is no fallback', () => {
    expect(getErrorMessage({ code: 1 })).toBe(JSON.stringify({ code: 1 }));
  });

  it('reads plain Error.message', () => {
    expect(getErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });
});
