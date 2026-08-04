import { McpConnectionError } from '../../../../src/core/errors';
import { validateRedirectUris } from '../../../../src/core/mcp/auth/redirectUri';

describe('validateRedirectUris', () => {
  it('accepts http(s) URLs', () => {
    expect(() =>
      validateRedirectUris({
        redirectUris: ['https://harness.example.com/settings', 'http://localhost:3000/cb'],
      }),
    ).not.toThrow();
  });

  it('rejects non-http(s) URIs', () => {
    expect(() =>
      validateRedirectUris({
        redirectUris: ['javascript:alert(1)'],
      }),
    ).toThrow(/Must be a valid URL/);
  });

  it('rejects malformed URIs', () => {
    expect(() =>
      validateRedirectUris({
        redirectUris: ['not-a-url'],
      }),
    ).toThrow(McpConnectionError);
  });
});
