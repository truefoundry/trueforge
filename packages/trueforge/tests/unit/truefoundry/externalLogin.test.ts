import { buildTrueFoundryExternalLoginHref } from '../../../src/truefoundry/externalLogin';

jest.mock('../../../src/config', () => {
  const actual = jest.requireActual<typeof import('../../../src/config')>('../../../src/config');
  return {
    ...actual,
    getPublicBaseUrl: () => 'https://app.example.com/trueforge',
  };
});

describe('buildTrueFoundryExternalLoginHref', () => {
  it('builds /signin/external on the PUBLIC_BASE_URL origin', () => {
    expect(buildTrueFoundryExternalLoginHref('/trueforge/')).toBe(
      'https://app.example.com/signin/external?redirectPath=%2Ftrueforge%2F',
    );
  });

  it('preserves a deep-link redirectPath', () => {
    expect(buildTrueFoundryExternalLoginHref('/trueforge/sessions/abc')).toBe(
      'https://app.example.com/signin/external?redirectPath=%2Ftrueforge%2Fsessions%2Fabc',
    );
  });
});
