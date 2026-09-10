import {
  buildTrueFoundryExternalLoginHref,
  resolveTrueFoundryLoginReturnTo,
  TRUEFOUNDRY_EXTERNAL_SIGNIN_PATH,
} from '../../../src/truefoundry/externalLogin';

jest.mock('../../../src/config', () => {
  const actual = jest.requireActual<typeof import('../../../src/config')>('../../../src/config');
  return {
    ...actual,
    getPublicBaseUrl: () => 'https://app.example.com/trueforge',
    getPublicUiBasePath: () => '/trueforge/',
  };
});

describe('buildTrueFoundryExternalLoginHref', () => {
  it('prefixes PUBLIC_BASE_URL origin onto return_to', () => {
    expect(buildTrueFoundryExternalLoginHref('/signin/external?redirectPath=%2Ftrueforge%2F')).toBe(
      'https://app.example.com/signin/external?redirectPath=%2Ftrueforge%2F',
    );
  });

  it('preserves a deep-link redirectPath inside return_to', () => {
    expect(buildTrueFoundryExternalLoginHref('/signin/external?redirectPath=%2Ftrueforge%2Fsessions%2Fabc')).toBe(
      'https://app.example.com/signin/external?redirectPath=%2Ftrueforge%2Fsessions%2Fabc',
    );
  });
});

describe('resolveTrueFoundryLoginReturnTo', () => {
  it('wraps a safe app path as redirectPath', () => {
    expect(resolveTrueFoundryLoginReturnTo('/trueforge/sessions/abc')).toBe(
      `${TRUEFOUNDRY_EXTERNAL_SIGNIN_PATH}?redirectPath=%2Ftrueforge%2Fsessions%2Fabc`,
    );
  });

  it('defaults to platform login with UI home when return_to is missing', () => {
    expect(resolveTrueFoundryLoginReturnTo(undefined)).toBe(
      `${TRUEFOUNDRY_EXTERNAL_SIGNIN_PATH}?redirectPath=%2Ftrueforge%2F`,
    );
  });

  it('defaults when return_to is unsafe', () => {
    expect(resolveTrueFoundryLoginReturnTo('//evil.example')).toBe(
      `${TRUEFOUNDRY_EXTERNAL_SIGNIN_PATH}?redirectPath=%2Ftrueforge%2F`,
    );
  });
});
