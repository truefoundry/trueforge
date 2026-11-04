afterEach(() => {
  jest.restoreAllMocks();
});

describe('model HTTP timeout configuration', () => {
  it.each([
    { raw: undefined, expected: 20_000 },
    { raw: '45000', expected: 45_000 },
  ])('uses a $expected ms header timeout when the environment value is $raw', ({ raw, expected }) => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      MODEL_HTTP_HEADERS_TIMEOUT_MS: raw,
      MODEL_HTTP_BODY_TIMEOUT_MS: undefined,
    });

    jest.isolateModules(() => {
      const { default: configuration } =
        jest.requireActual<typeof import('../../../src/config')>('../../../src/config');

      expect(configuration.MODEL_HTTP_HEADERS_TIMEOUT_MS).toBe(expected);
      expect(configuration.MODEL_HTTP_BODY_TIMEOUT_MS).toBe(120_000);
    });
  });
});
