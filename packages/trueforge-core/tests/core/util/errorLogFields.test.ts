import { describeUnknownError, extractErrorLogFields } from '../../../src/core/util/errorLogFields';

describe('extractErrorLogFields', () => {
  it('returns the message and stack for a plain error', () => {
    const error = new Error('boom');

    expect(extractErrorLogFields(error)).toEqual({ error: 'boom', stack: error.stack });
  });

  it('keeps the origin stack when the error was rethrown with a cause', () => {
    const origin = new Error('ECONNREFUSED');
    const wrapper = new Error('fetch failed', { cause: origin });

    expect(extractErrorLogFields(wrapper)).toEqual({
      error: 'fetch failed: ECONNREFUSED',
      stack: wrapper.stack,
      cause_stack: origin.stack,
    });
  });

  it('reports the deepest cause that carries a stack', () => {
    const root = new Error('root');
    const middle = new Error('middle', { cause: root });
    const outer = new Error('outer', { cause: middle });

    expect(extractErrorLogFields(outer).cause_stack).toBe(root.stack);
  });

  it('omits cause_stack when there is no cause', () => {
    expect(extractErrorLogFields(new Error('boom'))).not.toHaveProperty('cause_stack');
  });

  it('omits cause_stack when the cause is not an error', () => {
    expect(extractErrorLogFields(new Error('boom', { cause: 'a string' }))).not.toHaveProperty('cause_stack');
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
