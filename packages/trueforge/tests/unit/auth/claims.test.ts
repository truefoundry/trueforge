import {
  buildAuthorizationRequestParams,
  claimValues,
  resolveRole,
  resolveUserRef,
  toUserContext,
} from '../../../src/auth/claims';
import { EmailNotAllowedError } from '../../../src/auth/emailAllowlist';
import type { OIDCConfig } from '../../../src/config';

function config(overrides: Partial<OIDCConfig> = {}): OIDCConfig {
  return {
    OIDC_ISSUER_URL: 'https://example.okta.com/oauth2/default',
    OIDC_CLIENT_ID: 'client-id',
    OIDC_CLIENT_SECRET: 'client-secret',
    OIDC_USER_REFERENCE_CLAIM: 'sub',
    OIDC_USER_ROLE_CLAIM: 'groups',
    OIDC_ADMIN_ROLE_VALUE: 'harness-admins',
    OIDC_SCOPES: ['openid', 'profile', 'email', 'groups'],
    OIDC_ALLOWED_EMAILS: [],
    ...overrides,
  };
}

describe('claimValues', () => {
  it('passes through an array of strings', () => {
    expect(claimValues(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('drops non-string entries from an array', () => {
    expect(claimValues(['a', 1, null, 'b'])).toEqual(['a', 'b']);
  });

  it('wraps a bare string in a single-element array', () => {
    expect(claimValues('harness-admins')).toEqual(['harness-admins']);
  });

  it.each([undefined, null, 42, {}, true])('treats %p as no values', value => {
    expect(claimValues(value)).toEqual([]);
  });
});

describe('resolveUserRef', () => {
  it('reads the configured reference claim', () => {
    expect(resolveUserRef({ sub: 'user-123' }, config())).toBe('user-123');
  });

  it('reads a non-default reference claim when configured', () => {
    expect(resolveUserRef({ sub: 'user-123', email: 'a@b.com' }, config({ OIDC_USER_REFERENCE_CLAIM: 'email' }))).toBe(
      'a@b.com',
    );
  });

  it('throws when the claim is missing', () => {
    expect(() => resolveUserRef({}, config())).toThrow(/sub/);
  });

  it('throws when the claim is an empty string', () => {
    expect(() => resolveUserRef({ sub: '' }, config())).toThrow();
  });

  it('throws when the claim is not a string', () => {
    expect(() => resolveUserRef({ sub: 12345 }, config())).toThrow();
  });
});

describe('resolveRole', () => {
  it('is admin when the role claim array includes the admin value', () => {
    expect(resolveRole({ groups: ['everyone', 'harness-admins'] }, config())).toBe('admin');
  });

  it('is user when the role claim array does not include the admin value', () => {
    expect(resolveRole({ groups: ['everyone'] }, config())).toBe('user');
  });

  it('is user when the role claim is missing entirely', () => {
    expect(resolveRole({}, config())).toBe('user');
  });

  it('is admin when the role claim is a bare string matching the admin value', () => {
    expect(resolveRole({ groups: 'harness-admins' }, config())).toBe('admin');
  });

  it('is a case-sensitive match', () => {
    expect(resolveRole({ groups: ['Harness-Admins'] }, config())).toBe('user');
  });

  it('reads a non-default role claim (e.g. Azure App Roles) when configured', () => {
    expect(
      resolveRole({ roles: ['Admin'] }, config({ OIDC_USER_ROLE_CLAIM: 'roles', OIDC_ADMIN_ROLE_VALUE: 'Admin' })),
    ).toBe('admin');
  });
});

describe('toUserContext', () => {
  it('combines userRef and role from the claims', () => {
    expect(toUserContext({ sub: 'user-123', groups: ['harness-admins'] }, config())).toEqual({
      userRef: 'user-123',
      role: 'admin',
    });
  });

  it('propagates resolveUserRef throwing when the reference claim is missing', () => {
    expect(() => toUserContext({ groups: ['harness-admins'] }, config())).toThrow();
  });

  it('allows any email when the allowlist is empty', () => {
    expect(
      toUserContext(
        { sub: 'user-123', groups: [], email: 'anyone@elsewhere.com' },
        config({ OIDC_ALLOWED_EMAILS: [] }),
      ),
    ).toEqual({ userRef: 'user-123', role: 'user' });
  });

  it('throws EmailNotAllowedError when the email is outside the allowlist', () => {
    expect(() =>
      toUserContext(
        { sub: 'user-123', groups: [], email: 'outsider@elsewhere.com' },
        config({ OIDC_ALLOWED_EMAILS: ['*@company.com'] }),
      ),
    ).toThrow(EmailNotAllowedError);
  });

  it('allows a matching domain glob', () => {
    expect(
      toUserContext(
        { sub: 'user-123', groups: ['harness-admins'], email: 'alice@company.com' },
        config({ OIDC_ALLOWED_EMAILS: ['*@company.com'] }),
      ),
    ).toEqual({ userRef: 'user-123', role: 'admin' });
  });
});

describe('buildAuthorizationRequestParams', () => {
  it('requests configured scopes', () => {
    const { scopes } = buildAuthorizationRequestParams(
      config({ OIDC_SCOPES: ['openid', 'profile', 'email', 'offline_access'] }),
    );
    expect(scopes).toEqual(['openid', 'profile', 'email', 'offline_access']);
  });

  it('defaults to openid, profile, email, and groups', () => {
    const { scopes } = buildAuthorizationRequestParams(config());
    expect(scopes).toEqual(['openid', 'profile', 'email', 'groups']);
  });

  it('requests both the role claim and the (default) reference claim as essential in the id_token', () => {
    const { claims } = buildAuthorizationRequestParams(config({ OIDC_USER_ROLE_CLAIM: 'roles' }));
    expect(claims).toEqual({ id_token: { sub: { essential: true }, roles: { essential: true } } });
  });

  it('requests a non-default reference claim as essential too', () => {
    const { claims } = buildAuthorizationRequestParams(
      config({ OIDC_USER_REFERENCE_CLAIM: 'email', OIDC_USER_ROLE_CLAIM: 'roles' }),
    );
    expect(claims).toEqual({ id_token: { email: { essential: true }, roles: { essential: true } } });
  });

  it('collapses to a single essential entry when the reference and role claim names collide', () => {
    const { claims } = buildAuthorizationRequestParams(
      config({ OIDC_USER_REFERENCE_CLAIM: 'groups', OIDC_USER_ROLE_CLAIM: 'groups' }),
    );
    expect(claims).toEqual({ id_token: { groups: { essential: true } } });
  });

  it('requests email as essential when an allowlist is configured', () => {
    const { claims } = buildAuthorizationRequestParams(config({ OIDC_ALLOWED_EMAILS: ['*@company.com'] }));
    expect(claims).toEqual({
      id_token: { sub: { essential: true }, groups: { essential: true }, email: { essential: true } },
    });
  });
});
