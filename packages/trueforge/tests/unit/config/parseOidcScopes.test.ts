import { parseOidcScopes } from '../../../src/config';

describe('parseOidcScopes', () => {
  it('splits on commas and trims whitespace', () => {
    expect(parseOidcScopes('openid, profile , email,groups')).toEqual(['openid', 'profile', 'email', 'groups']);
  });

  it('throws when no scopes remain after parsing', () => {
    expect(() => parseOidcScopes(' , , ')).toThrow(/OIDC_SCOPES must contain at least one scope/);
  });
});
