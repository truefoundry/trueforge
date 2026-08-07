import { LOCAL_USER_CONTEXT, resolveUserContext } from '../../../src/auth/identity';

describe('resolveUserContext', () => {
  it('returns the local identity when auth is disabled', () => {
    expect(resolveUserContext()).toEqual(LOCAL_USER_CONTEXT);
    expect(LOCAL_USER_CONTEXT).toEqual({
      userRef: 'trueforge-default',
      role: 'admin',
    });
  });

  it('ignores a verified context when auth is disabled', () => {
    expect(resolveUserContext({ userRef: 'other', role: 'user' })).toEqual(LOCAL_USER_CONTEXT);
  });
});
