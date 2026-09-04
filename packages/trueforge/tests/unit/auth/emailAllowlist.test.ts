import { assertEmailAllowed, emailMatchesAllowlist, EmailNotAllowedError } from '../../../src/auth/emailAllowlist';
import type { OIDCConfig } from '../../../src/config';

function config(overrides: Partial<OIDCConfig> = {}): OIDCConfig {
  return {
    OIDC_ISSUER_URL: 'https://example.okta.com/oauth2/default',
    OIDC_CLIENT_ID: 'client-id',
    OIDC_CLIENT_SECRET: 'client-secret',
    OIDC_USER_REFERENCE_CLAIM: 'sub',
    OIDC_USER_DISPLAY_NAME_CLAIM: 'name',
    OIDC_USER_ROLE_CLAIM: 'groups',
    OIDC_ADMIN_ROLE_VALUE: 'admin',
    OIDC_SCOPES: ['openid', 'profile', 'email'],
    OIDC_ALLOWED_EMAILS: [],
    ...overrides,
  };
}

describe('emailMatchesAllowlist', () => {
  it('allows any email when the pattern list is empty', () => {
    expect(emailMatchesAllowlist('anyone@example.com', [])).toBe(true);
  });

  it('matches an exact address case-insensitively', () => {
    expect(emailMatchesAllowlist('Alice@Company.com', ['alice@company.com'])).toBe(true);
    expect(emailMatchesAllowlist('bob@company.com', ['alice@company.com'])).toBe(false);
  });

  it('matches a domain glob', () => {
    expect(emailMatchesAllowlist('alice@company.com', ['*@company.com'])).toBe(true);
    expect(emailMatchesAllowlist('alice@other.com', ['*@company.com'])).toBe(false);
  });

  it('matches when any of several patterns hits', () => {
    expect(emailMatchesAllowlist('bob@partner.com', ['alice@company.com', '*@partner.com'])).toBe(true);
  });

  it('treats dots in the pattern as literals, not wildcards', () => {
    expect(emailMatchesAllowlist('alice@companyXcom', ['*@company.com'])).toBe(false);
  });
});

describe('assertEmailAllowed', () => {
  it('is a no-op when the allowlist is empty', () => {
    expect(() => assertEmailAllowed({}, config())).not.toThrow();
  });

  it('throws when the email claim is missing', () => {
    expect(() => assertEmailAllowed({ sub: 'u1' }, config({ OIDC_ALLOWED_EMAILS: ['*@company.com'] }))).toThrow(
      EmailNotAllowedError,
    );
  });

  it('throws when the email does not match', () => {
    expect(() =>
      assertEmailAllowed({ email: 'outsider@elsewhere.com' }, config({ OIDC_ALLOWED_EMAILS: ['*@company.com'] })),
    ).toThrow(EmailNotAllowedError);
  });

  it('uses a generic login_failed message so redirects do not reveal allowlist membership', () => {
    expect(() =>
      assertEmailAllowed({ email: 'outsider@elsewhere.com' }, config({ OIDC_ALLOWED_EMAILS: ['*@company.com'] })),
    ).toThrow('login_failed');
  });

  it('allows a matching email', () => {
    expect(() =>
      assertEmailAllowed({ email: 'alice@company.com' }, config({ OIDC_ALLOWED_EMAILS: ['*@company.com'] })),
    ).not.toThrow();
  });
});
