import { describeUnknownError, extractErrorLogFields } from '../../../src/core/util/errorLogFields';

describe('extractErrorLogFields', () => {
  it('returns the message and stack for a plain error', () => {
    const error = new Error('boom');

    expect(extractErrorLogFields(error)).toEqual({ error: 'boom', stack: error.stack });
  });

  it('logs the origin stack when the error was rethrown with a cause', () => {
    const origin = new Error('ECONNREFUSED');
    const wrapper = new Error('fetch failed', { cause: origin });

    expect(extractErrorLogFields(wrapper)).toEqual({
      error: 'fetch failed: ECONNREFUSED',
      stack: origin.stack,
    });
  });

  it('uses the deepest cause stack', () => {
    const root = new Error('root');
    const middle = new Error('middle', { cause: root });
    const outer = new Error('outer', { cause: middle });

    expect(extractErrorLogFields(outer).stack).toBe(root.stack);
  });

  it('keeps the outer stack when the cause is not an error', () => {
    const error = new Error('boom', { cause: 'a string' });

    expect(extractErrorLogFields(error)).toEqual({ error: 'boom: a string', stack: error.stack });
  });

  it('survives a cause cycle', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    Object.defineProperty(a, 'cause', { value: b, configurable: true });

    expect(() => extractErrorLogFields(b)).not.toThrow();
  });

  it('describes non-error values without a stack', () => {
    expect(extractErrorLogFields('plain string')).toEqual({ error: 'plain string' });
  });
});

describe('describeUnknownError', () => {
  it('joins the cause chain', () => {
    const error = new Error('fetch failed', { cause: new Error('ECONNREFUSED') });

    expect(describeUnknownError(error)).toBe('fetch failed: ECONNREFUSED');
  });
});
