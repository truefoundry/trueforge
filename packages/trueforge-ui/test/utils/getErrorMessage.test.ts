import { describe, expect, it } from 'vitest';

import { decodeErrorMessageEscapes, getErrorMessage } from '@/utils/getErrorMessage.js';

describe('decodeErrorMessageEscapes', () => {
  it('decodes common JSON/C escapes when still literal', () => {
    expect(decodeErrorMessageEscapes('a\\nb\\tc\\rd')).toBe('a\nb\tc\nd');
    expect(decodeErrorMessageEscapes('say \\"hi\\" and \\\\')).toBe('say "hi" and \\');
    expect(decodeErrorMessageEscapes('bell\\b form\\f vert\\v null\\0')).toBe('bell\b form\f vert\v null\0');
  });

  it('decodes \\uXXXX and \\xHH', () => {
    expect(decodeErrorMessageEscapes('cafe\\u00e9')).toBe('cafeé');
    expect(decodeErrorMessageEscapes('A\\x42')).toBe('AB');
  });

  it('leaves already-decoded control characters unchanged and normalizes CR', () => {
    expect(decodeErrorMessageEscapes('a\nb\\tstill-literal')).toBe('a\nb\\tstill-literal');
    expect(decodeErrorMessageEscapes('a\nb\tc')).toBe('a\nb\tc');
    expect(decodeErrorMessageEscapes('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('keeps unknown escapes intact', () => {
    expect(decodeErrorMessageEscapes('not\\qescape')).toBe('not\\qescape');
    expect(decodeErrorMessageEscapes('bad\\uXX')).toBe('bad\\uXX');
  });
});

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

  it('decodes escapes in HTTP body error.message', () => {
    const err = Object.assign(new Error('request failed'), {
      statusCode: 400,
      body: {
        error: {
          message: '✖ must be 2–64 lowercase chars\\n  → at name\\tand also a tab',
        },
      },
    });
    expect(getErrorMessage(err)).toBe('✖ must be 2–64 lowercase chars\n  → at name\tand also a tab');
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
