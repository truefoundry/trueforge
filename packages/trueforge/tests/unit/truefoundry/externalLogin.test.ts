import {
  resolveTrueFoundryLoginReturnTo,
  TRUEFOUNDRY_EXTERNAL_SIGNIN_PATH,
} from '../../../src/truefoundry/externalLogin';

jest.mock('../../../src/config', () => {
  const actual = jest.requireActual<typeof import('../../../src/config')>('../../../src/config');
  return {
    ...actual,
    getPublicUiBasePath: () => '/trueforge/',
  };
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
