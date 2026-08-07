import type { Context } from 'hono';
import { LOCAL_USER_CONTEXT, resolveUserContext } from '../../../src/auth/identity';

describe('resolveUserContext', () => {
  it('returns the default local identity', () => {
    expect(resolveUserContext({} as Context)).toEqual(LOCAL_USER_CONTEXT);
    expect(LOCAL_USER_CONTEXT).toEqual({
      userRef: 'trueforge-default',
      role: 'admin',
    });
  });
});
