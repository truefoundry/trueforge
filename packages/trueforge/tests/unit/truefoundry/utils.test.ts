import { HTTPException } from 'hono/http-exception';
import {
  EFFECTIVE_USER_ID_SEPARATOR,
  getEffectiveUserIdFromAccessTokenSubject,
  parseAccessTokenSubject,
  type AccessTokenSubject,
} from '../../../src/truefoundry/utils';

/** Minimal unsigned JWT for unit tests (header.payload.); signature is ignored by decodeJwt. */
function unsignedJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

describe('parseAccessTokenSubject', () => {
  it('reads sub and defaults subjectType to user', () => {
    expect(parseAccessTokenSubject(unsignedJwt({ sub: 'user-1' }))).toEqual({
      subjectId: 'user-1',
      subjectType: 'user',
    });
  });

  it('prefers subjectType over legacy userType', () => {
    expect(
      parseAccessTokenSubject(unsignedJwt({ sub: 'va-1', subjectType: 'virtualaccount', userType: 'user' })),
    ).toEqual({
      subjectId: 'va-1',
      subjectType: 'virtualaccount',
    });
  });

  it('falls back to legacy userType', () => {
    expect(parseAccessTokenSubject(unsignedJwt({ sub: 'va-2', userType: 'virtualaccount' }))).toEqual({
      subjectId: 'va-2',
      subjectType: 'virtualaccount',
    });
  });

  it('captures subjectExternalIdentitySlug when present', () => {
    expect(
      parseAccessTokenSubject(
        unsignedJwt({
          sub: 'va-3',
          subjectType: 'virtualaccount',
          subjectExternalIdentitySlug: 'ext:alice@example.com',
        }),
      ),
    ).toEqual({
      subjectId: 'va-3',
      subjectType: 'virtualaccount',
      subjectExternalIdentitySlug: 'ext:alice@example.com',
    });
  });

  it('rejects missing sub', () => {
    expect(() => parseAccessTokenSubject(unsignedJwt({ subjectType: 'user' }))).toThrow(HTTPException);
  });

  it('rejects unsupported subject types', () => {
    expect(() => parseAccessTokenSubject(unsignedJwt({ sub: 'sa-1', subjectType: 'serviceaccount' }))).toThrow(
      HTTPException,
    );
  });
});

describe('getEffectiveUserIdFromAccessTokenSubject', () => {
  it('returns subjectId for users', () => {
    const subject: AccessTokenSubject = { subjectId: 'user-1', subjectType: 'user' };
    expect(getEffectiveUserIdFromAccessTokenSubject(subject)).toBe('user-1');
  });

  it('returns subjectId for virtualaccount without external identity', () => {
    const subject: AccessTokenSubject = { subjectId: 'va-1', subjectType: 'virtualaccount' };
    expect(getEffectiveUserIdFromAccessTokenSubject(subject)).toBe('va-1');
  });

  it('composes id:slug for virtualaccount with external identity', () => {
    const subject: AccessTokenSubject = {
      subjectId: 'va-1',
      subjectType: 'virtualaccount',
      subjectExternalIdentitySlug: 'ext:alice@example.com',
    };
    expect(getEffectiveUserIdFromAccessTokenSubject(subject)).toBe(
      `va-1${EFFECTIVE_USER_ID_SEPARATOR}ext:alice@example.com`,
    );
  });
});
