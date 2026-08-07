import type { Context } from 'hono';
import { LOCAL_USER_CONTEXT, resolveUserContext } from '../../../src/auth/identity';

describe('resolveUserContext', () => {
  it('returns the user set on the request context', () => {
    const c = {
      get: (key: string) => (key === 'user_context' ? LOCAL_USER_CONTEXT : undefined),
    } as unknown as Context;
    expect(resolveUserContext(c)).toEqual(LOCAL_USER_CONTEXT);
  });

  it('throws when auth middleware did not set user', () => {
    const c = {
      get: () => undefined,
    } as unknown as Context;
    expect(() => resolveUserContext(c)).toThrow('UserContext missing; auth middleware did not run');
  });
});
