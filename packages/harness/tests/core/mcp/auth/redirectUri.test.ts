import { McpConnectionError } from '../../../../src/core/errors';
import {
  MCP_LOOPBACK_REDIRECT_HOSTS,
  redirectUriMatches,
  validateRedirectUris,
} from '../../../../src/core/mcp/auth/redirectUri';

describe('redirectUriMatches', () => {
  it('matches identical strings', () => {
    expect(redirectUriMatches('https://app.example.com/cb', 'https://app.example.com/cb')).toBe(true);
  });

  it.each([
    ['127.0.0.1', 'http://127.0.0.1:8080/cb', 'http://127.0.0.1:54321/cb'],
    ['localhost', 'http://localhost:8080/cb', 'http://localhost:1234/cb'],
    ['0.0.0.0', 'http://0.0.0.0:8080/cb', 'http://0.0.0.0:9999/cb'],
  ])('wildcards the port for loopback host %s', (_label, candidate, registered) => {
    expect(redirectUriMatches(candidate, registered)).toBe(true);
  });

  it('rejects a different non-loopback origin', () => {
    expect(redirectUriMatches('https://evil.example.com/cb', 'https://app.example.com/cb')).toBe(false);
  });

  it('matches across distinct loopback hosts', () => {
    expect(redirectUriMatches('http://127.0.0.1:8080/cb', 'http://localhost:8080/cb')).toBe(true);
  });

  it('accepts same-origin path/query variants for non-loopback hosts', () => {
    expect(redirectUriMatches('https://app.example.com/settings/mcp', 'https://app.example.com')).toBe(true);
    expect(redirectUriMatches('https://app.example.com/cb?x=1', 'https://app.example.com/')).toBe(true);
  });

  it('rejects a non-loopback host with a different port', () => {
    expect(redirectUriMatches('https://app.example.com:8443/cb', 'https://app.example.com:443/cb')).toBe(false);
  });

  it('rejects non-http(s) schemes', () => {
    expect(redirectUriMatches('javascript:alert(1)', 'https://app.example.com/cb')).toBe(false);
  });

  it('returns false for malformed URLs that are not exact matches', () => {
    expect(redirectUriMatches('not-a-url', 'http://127.0.0.1:8080/cb')).toBe(false);
  });

  it('exposes the RFC 8252 loopback host set', () => {
    expect(MCP_LOOPBACK_REDIRECT_HOSTS.has('localhost')).toBe(true);
  });
});

describe('validateRedirectUris', () => {
  it('accepts allowlisted URIs', () => {
    expect(() =>
      validateRedirectUris({
        redirectUris: ['https://harness.example.com/settings'],
        allowList: ['https://harness.example.com'],
      }),
    ).not.toThrow();
  });

  it('rejects URIs outside the allowlist', () => {
    expect(() =>
      validateRedirectUris({
        redirectUris: ['https://evil.example.com/phish'],
        allowList: ['https://harness.example.com'],
      }),
    ).toThrow(McpConnectionError);
  });

  it('rejects non-http(s) URIs', () => {
    expect(() =>
      validateRedirectUris({
        redirectUris: ['javascript:alert(1)'],
        allowList: ['https://harness.example.com'],
      }),
    ).toThrow(/Must be a valid URL/);
  });
});
